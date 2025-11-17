import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { withDecryptedUserNames, type RawUserRecord } from '@/lib/customer-decrypt';

const PREP_QUEUE_TABLE = process.env.SUPABASE_PREP_QUEUE_TABLE ?? 'prep_queue';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const ORDER_CLIENT_ID_COLUMN =
  process.env.SUPABASE_ORDERS_CLIENT_ID_COLUMN?.trim() || null;
const MAX_RESULTS = Number(process.env.PREP_QUEUE_LIMIT ?? 100);

const normalizeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabaseAdmin
      .from(PREP_QUEUE_TABLE)
      .select('id,"orderItemId",status,"handledByStaffId","createdAt","updatedAt","completedAt"')
      .order('createdAt', { ascending: true })
      .limit(MAX_RESULTS);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: queueRows, error: queueError } = await query;

    if (queueError) {
      throw new Error(queueError.message);
    }

    const tasks = queueRows ?? [];

    if (!tasks.length) {
      return NextResponse.json({ success: true, data: [] });
    }

    const orderItemIds = tasks.map((task) => task.orderItemId).filter(Boolean);

    const [{ data: orderItems, error: orderItemsError }, { data: staff, error: staffError }] =
      await Promise.all([
        supabaseAdmin
          .from(ORDER_ITEMS_TABLE)
          .select('id,"orderId","productId",quantity,price,"createdAt"')
          .in('id', orderItemIds),
        supabaseAdmin
          .from(STAFF_TABLE)
          .select('id,email,role,"firstNameEncrypted","lastNameEncrypted"'),
      ]);

    if (orderItemsError) {
      console.error('Error fetching order items for prep queue:', orderItemsError);
    }
    if (staffError) {
      console.error('Error fetching staff data for prep queue:', staffError);
    }

    const orderIds = (orderItems ?? [])
      .map((item) => item.orderId)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);

    const productIds = (orderItems ?? [])
      .map((item) => item.productId)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);

    const orderSelectFields = [
      'id',
      '"orderNumber"',
      'status',
      'total',
      'currency',
      '"userId"',
      '"createdAt"',
    ];
    if (ORDER_CLIENT_ID_COLUMN) {
      orderSelectFields.push(`clientId:${ORDER_CLIENT_ID_COLUMN}`);
    }

    const [{ data: orders, error: ordersError }, { data: products, error: productsError }] =
      await Promise.all([
        orderIds.length
          ? supabaseAdmin.from(ORDERS_TABLE).select(orderSelectFields.join(',')).in('id', orderIds)
          : { data: [], error: null },
        productIds.length
          ? supabaseAdmin
              .from(PRODUCTS_TABLE)
              .select('id,name,category,subcategory')
              .in('id', productIds)
          : { data: [], error: null },
      ]);

    if (ordersError) {
      console.error('Error fetching orders for prep queue:', ordersError);
    }
    if (productsError) {
      console.error('Error fetching products for prep queue:', productsError);
    }

    const userIds = Array.from(
      new Set(
        ((orders ?? []) as Array<{ userId?: string | null }>)
          .map((order) => order?.userId ?? null)
          .filter((value): value is string => Boolean(value))
      )
    );

    let users: RawUserRecord[] | null = [];
    let usersError: { message: string } | null = null;

    if (userIds.length) {
      const {
        data: usersData,
        error: fetchUsersError,
      } = await supabaseAdmin
        .from(USERS_TABLE)
        .select(
          [
            '"id"',
            '"clientId"',
            '"email"',
            '"firstNameEncrypted"',
            '"firstNameIv"',
            '"firstNameTag"',
            '"firstNameSalt"',
            '"lastNameEncrypted"',
            '"lastNameIv"',
            '"lastNameTag"',
            '"lastNameSalt"',
          ].join(',')
        )
        .in('id', userIds);

      users = usersData as RawUserRecord[] | null;
      usersError = fetchUsersError;
    }

    if (usersError) {
      console.error('Error fetching customers for prep queue:', usersError);
    }

    const orderItemMap = new Map((orderItems ?? []).map((item) => [item.id, item]));
    const orderMap = new Map(
      ((orders ?? []) as Array<{ id?: string | null }>)
        .filter((order) => Boolean(order?.id))
        .map((order) => [String(order.id), order])
    );
    const productMap = new Map(
      ((products ?? []) as Array<{ id?: string | null }>)
        .filter((product) => Boolean(product?.id))
        .map((product) => [String(product.id), product])
    );
    const staffMap = new Map(
      ((staff ?? []) as Array<{ id?: string | null }>)
        .filter((member) => Boolean(member?.id))
        .map((member) => [String(member.id), member])
    );
    const customerMap = new Map(
      (users ?? [])
        .filter((user): user is RawUserRecord & { id: string } => Boolean(user?.id))
        .map((user) => {
          const enriched = withDecryptedUserNames(user);
          return [
            user.id as string,
            enriched
              ? {
                  ...enriched,
                  firstName: enriched.firstName ?? null,
                  lastName: enriched.lastName ?? null,
                  clientId: enriched.clientId ?? null,
                  email: typeof enriched.email === 'string' ? enriched.email.trim() : null,
                }
              : null,
          ];
        })
    );

    const buildCustomerPayload = (
      order: ({ userId?: string | null; clientId?: string | null } & Record<string, unknown>) | null
    ) => {
      const userId = order?.userId;
      if (!userId) {
        return null;
      }
      const customer = customerMap.get(userId);
      if (!customer) {
        return {
          id: userId,
          email: null,
          clientId: (order as { clientId?: string | null })?.clientId ?? null,
          name: null,
        };
      }
      const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
      return {
        id: userId,
        email: customer.email ?? null,
        clientId: customer.clientId ?? (order as { clientId?: string | null })?.clientId ?? null,
        name: name || null,
      };
    };

    const enriched = tasks.map((task) => {
      const item = orderItemMap.get(task.orderItemId) || null;
      const order = item ? orderMap.get(item.orderId) || null : null;
      const product = item ? productMap.get(item.productId) || null : null;
      const handler = task.handledByStaffId ? staffMap.get(task.handledByStaffId) || null : null;
      const customer = buildCustomerPayload(order ?? null);

      return {
        ...task,
        orderItem: item,
        order,
        product,
        handler,
        customer,
        amount: normalizeNumber(item?.price) * normalizeNumber(item?.quantity),
      };
    });

    return NextResponse.json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    console.error('Error fetching prep queue:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch prep queue' },
      { status: 500 }
    );
  }
}
