import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const parseEnvFile = (envPath) => {
  const content = fs.readFileSync(envPath, 'utf-8');
  return content.split(/\r?\n/).reduce((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return acc;
    }
    const idx = trimmed.indexOf('=');
    if (idx === -1) {
      return acc;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1');
    acc[key] = value;
    return acc;
  }, {});
};

const loadConfig = () => {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const env = parseEnvFile(envPath);
  const supabaseUrl =
    env.SUPABASE_URL ??
    env.NEXT_PUBLIC_SUPABASE_URL ??
    env.PUBLIC_SUPABASE_URL;
  const supabaseKey =
    env.SUPABASE_SERVICE_ROLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_SERVICE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration in .env.local.');
  }

  return {
    supabaseUrl,
    supabaseKey,
    prepTable: env.SUPABASE_PREP_QUEUE_TABLE ?? 'prep_queue',
    orderItemsTable: env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items',
    productsTable: env.SUPABASE_PRODUCTS_TABLE ?? 'products',
    ordersTable: env.SUPABASE_ORDERS_TABLE ?? 'orders',
  };
};

const main = async () => {
  const config = loadConfig();
  const client = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tasks, error: taskError } = await client
    .from(config.prepTable)
    .select('id,orderItemId,handledByStaffId,status,createdAt,updatedAt,completedAt')
    .order('createdAt', { ascending: false })
    .limit(20);

  if (taskError) {
    console.error('Prep queue query failed', taskError.message);
    process.exit(1);
  }

  const itemIds = (tasks ?? []).map((task) => task.orderItemId).filter(Boolean);

  const orderItems = itemIds.length
    ? await client
        .from(config.orderItemsTable)
        .select('id,orderId,productId,quantity,price,createdAt')
        .in('id', itemIds)
    : { data: [], error: null };

  if (orderItems.error) {
    console.error('Order items query failed', orderItems.error.message);
  }

  const orderIds = Array.from(
    new Set((orderItems.data ?? []).map((item) => item.orderId).filter(Boolean))
  );
  const orders = orderIds.length
    ? await client
        .from(config.ordersTable)
        .select('id,orderNumber,status,total')
        .in('id', orderIds)
    : { data: [], error: null };

  if (orders.error) {
    console.error('Orders query failed', orders.error.message);
  }

  const productIds = Array.from(
    new Set(
      (orderItems.data ?? [])
        .map((item) => item.productId)
        .filter(Boolean)
    )
  );
  const products = productIds.length
    ? await client
        .from(config.productsTable)
        .select('id,name,category')
        .in('id', productIds)
    : { data: [], error: null };

  if (products.error) {
    console.error('Products query failed', products.error.message);
  }

  const itemsById = new Map((orderItems.data ?? []).map((item) => [item.id, item]));
  const ordersById = new Map((orders.data ?? []).map((order) => [order.id, order]));
  const productsById = new Map((products.data ?? []).map((product) => [product.id, product]));

  console.log('Prep queue snapshot:');
  (tasks ?? []).forEach((task) => {
    const item = task.orderItemId ? itemsById.get(task.orderItemId) : null;
    const order = item?.orderId ? ordersById.get(item.orderId) : null;
    const product = item?.productId ? productsById.get(item.productId) : null;
    console.log({
      taskId: task.id,
      status: task.status,
      handledByStaffId: task.handledByStaffId,
      orderItemId: task.orderItemId,
      orderId: item?.orderId ?? order?.id,
      orderNumber: order?.orderNumber,
      total: order?.total,
      productId: item?.productId,
      productName: product?.name,
      quantity: item?.quantity,
      price: item?.price,
    });
  });
};

main().catch((error) => {
  console.error('Unexpected error', error);
  process.exit(1);
});
