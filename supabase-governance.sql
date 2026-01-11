-- =====================================================================
--  XocoCafe - Esquema base para Supabase/PostgreSQL
--  Este script alinea la estructura de la base de datos con los modelos
--  definidos en prisma/schema.prisma (migración manual inicial).
--  Ejecuta en el esquema "public".
-- =====================================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Tabla principal de usuarios
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT,
  "clientId" TEXT NOT NULL UNIQUE,
  "walletAddress" TEXT,
  "authProvider" TEXT NOT NULL DEFAULT 'email',
  "googleId" TEXT UNIQUE,

  -- Datos personales cifrados
  "firstNameEncrypted" TEXT,
  "firstNameIv" TEXT,
  "firstNameTag" TEXT,
  "firstNameSalt" TEXT,
  "lastNameEncrypted" TEXT,
  "lastNameIv" TEXT,
  "lastNameTag" TEXT,
  "lastNameSalt" TEXT,
  "phoneEncrypted" TEXT,
  "phoneIv" TEXT,
  "phoneTag" TEXT,
  "phoneSalt" TEXT,

  -- Datos sin cifrar
  city TEXT,
  country TEXT,

  -- Consentimientos
  "termsAccepted" BOOLEAN NOT NULL DEFAULT FALSE,
  "privacyAccepted" BOOLEAN NOT NULL DEFAULT FALSE,
  "marketingEmail" BOOLEAN NOT NULL DEFAULT FALSE,
  "marketingSms" BOOLEAN NOT NULL DEFAULT FALSE,
  "marketingPush" BOOLEAN NOT NULL DEFAULT FALSE,
  "consentUpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Auditoría / retención
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastLoginAt" TIMESTAMPTZ,
  "lastActivityAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "dataRetentionUntil" TIMESTAMPTZ,

  -- Analítica pasiva
  "registrationSource" TEXT,
  "userAgent" TEXT,
  "ipAddress" INET,
  "referrerUrl" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmTerm" TEXT,
  "utmContent" TEXT,

  -- Detección de dispositivo/idioma
  "detectedLanguage" TEXT DEFAULT 'es',
  "deviceType" TEXT,
  "browserLanguage" TEXT,
  timezone TEXT,
  platform TEXT,

  -- Métricas de comportamiento
  "totalSessions" INTEGER NOT NULL DEFAULT 0,
  "totalPageViews" INTEGER NOT NULL DEFAULT 0,
  "avgSessionDuration" INTEGER NOT NULL DEFAULT 0,

  -- Datos adicionales
  "avatarUrl" TEXT,
  "favoriteColdDrink" TEXT,
  "favoriteHotDrink" TEXT,
  "favoriteFood" TEXT,

  -- Programa de lealtad
  "weeklyCoffeeCount" INTEGER NOT NULL DEFAULT 0,
  "monthlyMetrics" JSONB,

  -- Segmentación
  "userSegment" TEXT,
  "acquisitionChannel" TEXT,
  "lifetimeValue" NUMERIC(10,2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);
CREATE INDEX IF NOT EXISTS users_client_id_idx ON public.users ("clientId");
CREATE INDEX IF NOT EXISTS users_google_id_idx ON public.users ("googleId");
CREATE INDEX IF NOT EXISTS users_created_at_idx ON public.users ("createdAt");

-- Trigger para updatedAt
CREATE OR REPLACE FUNCTION public.touch_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_touch_updated_at ON public.users;
CREATE TRIGGER trg_users_touch_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

-- ---------------------------------------------------------------------
-- Direcciones de usuario
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.addresses (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  street TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT,
  "postalCode" TEXT NOT NULL,
  country TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS addresses_user_id_idx ON public.addresses ("userId");

DROP TRIGGER IF EXISTS trg_addresses_touch_updated_at ON public.addresses;
CREATE TRIGGER trg_addresses_touch_updated_at
  BEFORE UPDATE ON public.addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

-- ---------------------------------------------------------------------
-- Pedidos y artículos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "orderNumber" TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_user_id_idx ON public.orders ("userId");

DROP TRIGGER IF EXISTS trg_orders_touch_updated_at ON public.orders;
CREATE TRIGGER trg_orders_touch_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

CREATE TABLE IF NOT EXISTS public.order_items (
  id TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  "productId" TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  discount NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items ("orderId");

-- ---------------------------------------------------------------------
-- Programa de lealtad
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_points (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  "orderId" TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS loyalty_points_user_id_idx ON public.loyalty_points ("userId");

-- ---------------------------------------------------------------------
-- Sesiones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sessions (
  id TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  "ipAddress" INET,
  "userAgent" TEXT,
  "deviceType" TEXT,
  browser TEXT,
  os TEXT,
  country TEXT,
  city TEXT,
  "sessionDuration" INTEGER NOT NULL DEFAULT 0,
  "pageViews" INTEGER NOT NULL DEFAULT 0,
  "lastActivityAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions ("userId");
CREATE INDEX IF NOT EXISTS sessions_token_idx ON public.sessions (token);

-- ---------------------------------------------------------------------
-- Logs de retención de datos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_retention_logs (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" INET,
  "userAgent" TEXT,
  "adminUserId" TEXT
);

CREATE INDEX IF NOT EXISTS data_retention_logs_user_id_idx
  ON public.data_retention_logs ("userId");

-- ---------------------------------------------------------------------
-- Analítica de páginas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.page_analytics (
  id TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  "sessionId" TEXT REFERENCES public.sessions(id) ON DELETE SET NULL,
  "pagePath" TEXT NOT NULL,
  "pageTitle" TEXT,
  "pageCategory" TEXT,
  "timeOnPage" INTEGER NOT NULL DEFAULT 0,
  "scrollDepth" INTEGER NOT NULL DEFAULT 0,
  bounce BOOLEAN NOT NULL DEFAULT FALSE,
  "exitPage" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" INET,
  "userAgent" TEXT,
  "referrerUrl" TEXT,
  "conversionEvent" TEXT,
  "conversionValue" NUMERIC(10,2)
);

CREATE INDEX IF NOT EXISTS page_analytics_user_id_idx ON public.page_analytics ("userId");
CREATE INDEX IF NOT EXISTS page_analytics_session_id_idx ON public.page_analytics ("sessionId");

-- ---------------------------------------------------------------------
-- Eventos de conversión
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversion_events (
  id TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  "sessionId" TEXT REFERENCES public.sessions(id) ON DELETE SET NULL,
  "eventType" TEXT NOT NULL,
  "eventCategory" TEXT,
  "eventValue" NUMERIC(10,2),
  "eventData" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" INET,
  "userAgent" TEXT,
  "pagePath" TEXT
);

CREATE INDEX IF NOT EXISTS conversion_events_user_id_idx ON public.conversion_events ("userId");
CREATE INDEX IF NOT EXISTS conversion_events_session_id_idx ON public.conversion_events ("sessionId");

-- ---------------------------------------------------------------------
-- Productos y reseñas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  price NUMERIC(10,2) NOT NULL,
  cost NUMERIC(10,2),
  "totalSales" INTEGER NOT NULL DEFAULT 0,
  "totalRevenue" NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  "avgRating" NUMERIC(3,2) NOT NULL DEFAULT 0.00,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "stockQuantity" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB,
  items JSONB
);

DROP TRIGGER IF EXISTS trg_products_touch_updated_at ON public.products;
CREATE TRIGGER trg_products_touch_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

CREATE TABLE IF NOT EXISTS public.reviews (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  "orderId" TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  "helpfulVotes" INTEGER NOT NULL DEFAULT 0,
  "totalVotes" INTEGER NOT NULL DEFAULT 0,
  "verifiedPurchase" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_reviews_touch_updated_at ON public.reviews;
CREATE TRIGGER trg_reviews_touch_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

CREATE INDEX IF NOT EXISTS reviews_user_id_idx ON public.reviews ("userId");
CREATE INDEX IF NOT EXISTS reviews_product_id_idx ON public.reviews ("productId");

-- ---------------------------------------------------------------------
-- Funciones de métricas automáticas
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_profile_metrics()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'page_analytics' THEN
    UPDATE public.users
      SET "lastActivityAt" = NOW(),
          "totalPageViews" = COALESCE("totalPageViews", 0) + 1
    WHERE id = NEW."userId";
  ELSIF TG_TABLE_NAME = 'sessions' THEN
    UPDATE public.users
      SET "totalSessions" = COALESCE("totalSessions", 0) + 1,
          "lastLoginAt" = NOW(),
          "lastActivityAt" = NOW()
    WHERE id = NEW."userId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.calculate_user_segment()
RETURNS TRIGGER AS $$
DECLARE
  days_since_last_login INTEGER := 9999;
  total_orders INTEGER := 0;
BEGIN
  SELECT COALESCE(EXTRACT(DAY FROM NOW() - u."lastLoginAt")::INT, 9999)
    INTO days_since_last_login
  FROM public.users u WHERE u.id = NEW.id;

  SELECT COUNT(*) INTO total_orders
  FROM public.orders o WHERE o."userId" = NEW.id;

  IF days_since_last_login <= 7 THEN
    NEW."userSegment" := 'active';
  ELSIF days_since_last_login <= 30 THEN
    NEW."userSegment" := 'engaged';
  ELSIF days_since_last_login <= 90 THEN
    NEW."userSegment" := 'at_risk';
  ELSE
    NEW."userSegment" := 'churned';
  END IF;

  IF total_orders >= 10 THEN
    NEW."userSegment" := 'vip';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_profile_metrics_page ON public.page_analytics;
CREATE TRIGGER update_profile_metrics_page
  AFTER INSERT ON public.page_analytics
  FOR EACH ROW EXECUTE FUNCTION public.update_profile_metrics();

DROP TRIGGER IF EXISTS update_profile_metrics_session ON public.sessions;
CREATE TRIGGER update_profile_metrics_session
  AFTER INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_profile_metrics();

DROP TRIGGER IF EXISTS calculate_user_segment_trigger ON public.users;
CREATE TRIGGER calculate_user_segment_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.calculate_user_segment();

-- ---------------------------------------------------------------------
-- Sincronización con auth.users (opcional si se usa Supabase Auth)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_last_login_from_auth()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    UPDATE public.users
      SET "lastLoginAt" = NEW.last_sign_in_at,
          "lastActivityAt" = NEW.last_sign_in_at
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_last_login_from_auth ON auth.users;
CREATE TRIGGER trg_sync_last_login_from_auth
AFTER UPDATE OF last_sign_in_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_last_login_from_auth();

-- =====================================================================
--  Fin del script
-- =====================================================================
ALTER TABLE public.loyalty_points ADD COLUMN IF NOT EXISTS metadata JSONB;
INSERT INTO public.products (
  id, "productId", name, category, subcategory, price, cost,
  "totalSales", "totalRevenue", "avgRating", "reviewCount",
  "stockQuantity", "lowStockThreshold", "createdAt", "updatedAt", "isActive"
) VALUES (
  gen_random_uuid(), 'feedback-general', 'Feedback general',
  'feedback', 'comentarios', 0, 0,
  0, 0, 0, 0, 0, 0, NOW(), NOW(), TRUE
)
ON CONFLICT ("productId") DO NOTHING;


-- =====================================================================
--  PATCH: orders.items + sincronización desde order_items
-- =====================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.refresh_orders_items_from_order_items()
RETURNS TRIGGER AS $$
DECLARE
  v_orderId TEXT;
BEGIN
  v_orderId := COALESCE(NEW."orderId", OLD."orderId");

  UPDATE public.orders o
  SET items = (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'productId', oi."productId",
          'quantity',  oi.quantity,
          'price',     oi.price
        )
        ORDER BY oi."createdAt"
      ),
      '[]'::jsonb
    )
    FROM public.order_items oi
    WHERE oi."orderId" = v_orderId
  )
  WHERE o.id = v_orderId;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_items_refresh_items_ins ON public.order_items;
CREATE TRIGGER trg_order_items_refresh_items_ins
  AFTER INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_orders_items_from_order_items();

DROP TRIGGER IF EXISTS trg_order_items_refresh_items_upd ON public.order_items;
CREATE TRIGGER trg_order_items_refresh_items_upd
  AFTER UPDATE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_orders_items_from_order_items();

DROP TRIGGER IF EXISTS trg_order_items_refresh_items_del ON public.order_items;
CREATE TRIGGER trg_order_items_refresh_items_del
  AFTER DELETE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_orders_items_from_order_items();

-- Backfill
UPDATE public.orders o
SET items = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'productId', oi."productId",
        'quantity',  oi.quantity,
        'price',     oi.price
      )
      ORDER BY oi."createdAt"
    ),
    '[]'::jsonb
  )
  FROM public.order_items oi
  WHERE oi."orderId" = o.id
);


-- =====================================================================
--  Módulos adicionales (Clientes + POS)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 0) Sucursales
CREATE TABLE IF NOT EXISTS public.branches (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  street TEXT,
  city TEXT,
  state TEXT,
  "postalCode" TEXT,
  country TEXT DEFAULT 'MX',
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_branches_touch_updated_at ON public.branches;
CREATE TRIGGER trg_branches_touch_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

INSERT INTO public.branches (id, code, name, city, country)
VALUES ('MATRIZ', 'MATRIZ', 'Sucursal Matriz', 'Ciudad de México', 'MX')
ON CONFLICT (id) DO NOTHING;

-- Generador A-Z
CREATE OR REPLACE FUNCTION public.generate_alpha_code(p_len INT)
RETURNS TEXT AS $$
DECLARE
  chars CONSTANT TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  clen  INT := length(chars);
  out   TEXT := '';
  i     INT := 1;
BEGIN
  IF p_len IS NULL OR p_len < 1 THEN
    RAISE EXCEPTION 'generate_alpha_code: length must be >= 1';
  END IF;
  WHILE i <= p_len LOOP
    out := out || substr(chars, 1 + floor(random() * clen)::INT, 1);
    i := i + 1;
  END LOOP;
  RETURN out;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Códigos cortos por pedido (no toca orders)
CREATE TABLE IF NOT EXISTS public.order_codes (
  id TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.ensure_order_code()
RETURNS TRIGGER AS $$
DECLARE candidate TEXT;
BEGIN
  IF NEW.code IS NULL THEN
    LOOP
      candidate := public.generate_alpha_code(5);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.order_codes WHERE code = candidate);
    END LOOP;
    NEW.code := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_codes_generate ON public.order_codes;
CREATE TRIGGER trg_order_codes_generate
  BEFORE INSERT ON public.order_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_order_code();

-- Tickets (usa orders.items)
CREATE TABLE IF NOT EXISTS public.tickets (
  id TEXT PRIMARY KEY,
  "ticketCode" TEXT NOT NULL UNIQUE,
  "orderId" TEXT NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  "userId"  TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "branchId" TEXT NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT DEFAULT 'MATRIZ',
  currency TEXT NOT NULL DEFAULT 'MXN',
  "tipPercent" NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK ("tipPercent" >= 0 AND "tipPercent" <= 50),
  "tipAmount"  NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  "paymentMethod" TEXT NOT NULL,
  "paymentDetails" JSONB,
  "qrPayload" JSONB,
  "qrImageUrl" TEXT,
  "ticketImageUrl" TEXT,
  "emailSentAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tickets_order_id_idx ON public.tickets ("orderId");
CREATE INDEX IF NOT EXISTS tickets_user_id_idx ON public.tickets ("userId");

DROP TRIGGER IF EXISTS trg_tickets_touch_updated_at ON public.tickets;
CREATE TRIGGER trg_tickets_touch_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

CREATE OR REPLACE FUNCTION public.tickets_set_defaults()
RETURNS TRIGGER AS $$
DECLARE
  candidate   TEXT;
  order_total NUMERIC(12,2);
  items       JSONB;
  client_id   TEXT;
  grand_total NUMERIC(12,2);
BEGIN
  IF NEW."ticketCode" IS NULL THEN
    LOOP
      candidate := public.generate_alpha_code(5);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tickets WHERE "ticketCode" = candidate);
    END LOOP;
    NEW."ticketCode" := candidate;
  END IF;

  SELECT o.total, o.items INTO order_total, items
  FROM public.orders o WHERE o.id = NEW."orderId";

  SELECT u."clientId" INTO client_id FROM public.users u WHERE u.id = NEW."userId";

  grand_total := COALESCE(order_total,0) + COALESCE(NEW."tipAmount",0);
  IF items IS NULL THEN items := '[]'::jsonb; END IF;

  NEW."qrPayload" := jsonb_pretty(
    jsonb_build_object(
      'ticketCode',  NEW."ticketCode",
      'ticketId',    COALESCE(NEW.id, 'pending'),
      'clientId',    client_id,
      'userId',      NEW."userId",
      'createdAt',   COALESCE(NEW."createdAt", NOW()),
      'items',       items,
      'totals',      jsonb_build_object(
                       'orderTotal', order_total,
                       'tipPercent', NEW."tipPercent",
                       'tipAmount',  NEW."tipAmount",
                       'grandTotal', grand_total
                     )
    )
  )::jsonb;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tickets_set_defaults ON public.tickets;
CREATE TRIGGER trg_tickets_set_defaults
  BEFORE INSERT OR UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.tickets_set_defaults();

-- Pagos
CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY,
  "orderId"  TEXT REFERENCES public.orders(id) ON DELETE CASCADE,
  "ticketId" TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  status TEXT NOT NULL DEFAULT 'initiated',
  "tipAmount"  NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  "tipPercent" NUMERIC(5,2)  NOT NULL DEFAULT 0.00,
  "cryptoToken" TEXT,
  "cryptoChain" TEXT,
  "externalPaymentId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_order_id_idx  ON public.payments ("orderId");
CREATE INDEX IF NOT EXISTS payments_ticket_id_idx ON public.payments ("ticketId");

DROP TRIGGER IF EXISTS trg_payments_touch_updated_at ON public.payments;
CREATE TRIGGER trg_payments_touch_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

-- Reservas
CREATE TABLE IF NOT EXISTS public.reservations (
  id TEXT PRIMARY KEY,
  "reservationCode" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "peopleCount" SMALLINT NOT NULL CHECK ("peopleCount" >= 1 AND "peopleCount" <= 15),
  "reservationDate" DATE NOT NULL,
  "reservationTime" TIME NOT NULL,
  "branchId" TEXT NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT DEFAULT 'MATRIZ',
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reservations_user_id_idx ON public.reservations ("userId");

DROP TRIGGER IF EXISTS trg_reservations_touch_updated_at ON public.reservations;
CREATE TRIGGER trg_reservations_touch_updated_at
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

CREATE OR REPLACE FUNCTION public.reservations_enforce_matriz()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."branchId" <> 'MATRIZ' THEN
    RAISE EXCEPTION 'Por ahora sólo se permite la sucursal MATRIZ';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservations_matriz_only ON public.reservations;
CREATE TRIGGER trg_reservations_matriz_only
  BEFORE INSERT OR UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.reservations_enforce_matriz();

CREATE OR REPLACE FUNCTION public.ensure_reservation_code()
RETURNS TRIGGER AS $$
DECLARE candidate TEXT;
BEGIN
  IF NEW."reservationCode" IS NULL THEN
    LOOP
      candidate := public.generate_alpha_code(3);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reservations WHERE "reservationCode" = candidate);
    END LOOP;
    NEW."reservationCode" := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservations_generate_code ON public.reservations;
CREATE TRIGGER trg_reservations_generate_code
  BEFORE INSERT ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_reservation_code();

-- Vistas cliente
CREATE OR REPLACE VIEW public.v_client_recent_tickets AS
SELECT
  t.id,
  t."ticketCode",
  t."userId",
  t."createdAt",
  o.total       AS "orderTotal",
  t."tipAmount" AS "tipAmount",
  (o.total + t."tipAmount")::NUMERIC(12,2) AS "grandTotal"
FROM public.tickets t
JOIN public.orders o ON o.id = t."orderId"
WHERE t."createdAt" >= (NOW() - INTERVAL '30 days');

CREATE OR REPLACE PROCEDURE public.purge_old_tickets(p_days INT DEFAULT 30)
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.tickets
  WHERE "createdAt" < NOW() - (p_days || ' days')::INTERVAL;
END;
$$;

-- 2) POS: staff, sesiones, cola, inventario, reportes
CREATE TABLE IF NOT EXISTS public.staff_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT,
  "authProvider" TEXT NOT NULL DEFAULT 'email',
  "googleId" TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('barista','gerente','socio','super_admin')),
  "branchId" TEXT REFERENCES public.branches(id) ON DELETE SET NULL DEFAULT 'MATRIZ',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Datos personales cifrados (con Salt por campo)
  "firstNameEncrypted" TEXT,
  "firstNameIv" TEXT,
  "firstNameTag" TEXT,
  "firstNameSalt" TEXT,
  "lastNameEncrypted" TEXT,
  "lastNameIv" TEXT,
  "lastNameTag" TEXT,
  "lastNameSalt" TEXT,
  "phoneEncrypted" TEXT,
  "phoneIv" TEXT,
  "phoneTag" TEXT,
  "phoneSalt" TEXT,

  "createdBy" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastLoginAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS staff_users_role_idx ON public.staff_users (role);
CREATE INDEX IF NOT EXISTS staff_users_branch_idx ON public.staff_users ("branchId");

DROP TRIGGER IF EXISTS trg_staff_users_touch_updated_at ON public.staff_users;
CREATE TRIGGER trg_staff_users_touch_updated_at
  BEFORE UPDATE ON public.staff_users
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

CREATE TABLE IF NOT EXISTS public.staff_sessions (
  id TEXT PRIMARY KEY,
  "staffId" TEXT NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  "sessionStart" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "sessionEnd"   TIMESTAMPTZ,
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "ipAddress" INET,
  "userAgent" TEXT,
  "deviceType" TEXT,
  browser TEXT,
  os TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS staff_sessions_staff_id_idx ON public.staff_sessions ("staffId");

DROP TRIGGER IF EXISTS trg_staff_sessions_touch_updated_at ON public.staff_sessions;
CREATE TRIGGER trg_staff_sessions_touch_updated_at
  BEFORE UPDATE ON public.staff_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

CREATE OR REPLACE FUNCTION public.staff_sessions_set_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."sessionEnd" IS NOT NULL THEN
    NEW."durationSeconds" := GREATEST(0, EXTRACT(EPOCH FROM (NEW."sessionEnd" - NEW."sessionStart"))::INT);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_sessions_duration ON public.staff_sessions;
CREATE TRIGGER trg_staff_sessions_duration
  BEFORE UPDATE OF "sessionEnd" ON public.staff_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_sessions_set_duration();

CREATE TABLE IF NOT EXISTS public.prep_queue (
  id TEXT PRIMARY KEY,
  "orderItemId" TEXT NOT NULL UNIQUE REFERENCES public.order_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  "handledByStaffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS prep_queue_status_idx ON public.prep_queue (status);

DROP TRIGGER IF EXISTS trg_prep_queue_touch_updated_at ON public.prep_queue;
CREATE TRIGGER trg_prep_queue_touch_updated_at
  BEFORE UPDATE ON public.prep_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

DROP FUNCTION IF EXISTS public.enqueue_order_item();
-- Nota: la cola de producción ahora se alimenta únicamente desde el POS vía /api/orders/:id/queue,
-- evitando que los pedidos se marquen como "En preparación" automáticamente al insertarse los artículos.

-- ---------------------------------------------------------------------
-- Turnos de caja y ventas (corte NOM-251)
-- Ajustes incrementales: evitamos recrear tablas existentes.
-- ---------------------------------------------------------------------
ALTER TABLE public.turnos
  ADD COLUMN IF NOT EXISTS usuario_id TEXT,
  ADD COLUMN IF NOT EXISTS fecha_apertura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS fecha_cierre TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS saldo_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ventas_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_gastos_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'abierto';

ALTER TABLE public.turnos
  ALTER COLUMN usuario_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'turnos_estado_ck'
      AND conrelid = 'public.turnos'::regclass
  ) THEN
    ALTER TABLE public.turnos
      ADD CONSTRAINT turnos_estado_ck
        CHECK (estado IN ('abierto','cerrado'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS turnos_usuario_idx ON public.turnos (usuario_id);
CREATE INDEX IF NOT EXISTS turnos_estado_idx ON public.turnos (estado);

ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS turno_id INTEGER REFERENCES public.turnos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL,
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS monto_recibido NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cambio_entregado NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fecha TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ventas_metodo_pago_ck'
      AND conrelid = 'public.ventas'::regclass
  ) THEN
    ALTER TABLE public.ventas
      ADD CONSTRAINT ventas_metodo_pago_ck
        CHECK (metodo_pago IN ('efectivo','tarjeta','transferencia'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS ventas_turno_id_idx ON public.ventas (turno_id);

DROP TRIGGER IF EXISTS trg_order_items_enqueue ON public.order_items;

CREATE TABLE IF NOT EXISTS public.inventory_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

INSERT INTO public.inventory_categories (id, code, name) VALUES
  ('CAT_FOOD','food','Alimentos'),
  ('CAT_BEV','beverage_supplies','Insumos de bebidas'),
  ('CAT_CLN','cleaning','Insumos de limpieza'),
  ('CAT_DIS','disposables','Desechables')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id TEXT PRIMARY KEY,
  "categoryId" TEXT NOT NULL REFERENCES public.inventory_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unidad',
  "minStock" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_inventory_items_touch_updated_at ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_touch_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

CREATE TABLE IF NOT EXISTS public.inventory_stock (
  id TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  "branchId" TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_uq ON public.inventory_stock("itemId","branchId");

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  "branchId" TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
  quantity NUMERIC(12,3) NOT NULL,
  reason TEXT,
  "relatedOrderItemId" TEXT REFERENCES public.order_items(id) ON DELETE SET NULL,
  "createdByStaffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pos_action_logs (
  id TEXT PRIMARY KEY,
  "staffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  level TEXT NOT NULL DEFAULT 'info',
  "ipAddress" INET,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.report_requests (
  id TEXT PRIMARY KEY,
  "requestedByStaffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('sales','customers','employees')),
  granularity TEXT NOT NULL CHECK (granularity IN ('day','week','month','year')),
  "periodStart" DATE NOT NULL,
  "periodEnd"   DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  "resultUrl" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_report_requests_touch_updated_at ON public.report_requests;
CREATE TRIGGER trg_report_requests_touch_updated_at
  BEFORE UPDATE ON public.report_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

-- Vistas POS/Cliente
CREATE OR REPLACE VIEW public.v_pending_orders AS
SELECT
  o.id            AS "orderId",
  oc.code         AS "orderShortCode",
  o."userId",
  u."clientId",
  o.status,
  o.total,
  'MATRIZ'::TEXT  AS "branchId",
  o."createdAt"
FROM public.orders o
LEFT JOIN public.order_codes oc ON oc."orderId" = o.id
LEFT JOIN public.users u ON u.id = o."userId"
WHERE o.status IN ('pending','processing')
ORDER BY o."createdAt" DESC;

CREATE OR REPLACE VIEW public.v_ticket_lines AS
SELECT
  t.id           AS "ticketId",
  t."ticketCode",
  oi.quantity,
  p.name         AS product,
  oi.price
FROM public.tickets t
JOIN public.order_items oi ON oi."orderId" = t."orderId"
LEFT JOIN public.products p ON p.id = oi."productId"
ORDER BY t."createdAt" DESC, p.name;

CREATE OR REPLACE VIEW public.v_customer_last_month AS
SELECT
  u.id          AS "userId",
  u."clientId",
  COUNT(DISTINCT o.id)           AS orders,
  COALESCE(SUM(o.total),0)::NUMERIC(12,2) AS spent,
  COALESCE(SUM(oi.quantity),0)  AS items
FROM public.users u
LEFT JOIN public.orders o ON o."userId" = u.id
  AND o."createdAt" >= (NOW() - INTERVAL '30 days')
LEFT JOIN public.order_items oi ON oi."orderId" = o.id
GROUP BY u.id, u."clientId";

-- Direcciones: mejoras (máx. 5, defaults por tipo)
ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS label TEXT;

CREATE INDEX IF NOT EXISTS addresses_user_id_type_idx
  ON public.addresses ("userId", type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'addresses_type_ck'
  ) THEN
    ALTER TABLE public.addresses
      ADD CONSTRAINT addresses_type_ck
      CHECK (type IN ('shipping','billing','other'));
  END IF;
END$$;

DROP INDEX IF EXISTS addresses_unique_default_shipping;
CREATE UNIQUE INDEX addresses_unique_default_shipping
  ON public.addresses ("userId")
  WHERE (type = 'shipping' AND "isDefault" IS TRUE);

DROP INDEX IF EXISTS addresses_unique_default_billing;
CREATE UNIQUE INDEX addresses_unique_default_billing
  ON public.addresses ("userId")
  WHERE (type = 'billing' AND "isDefault" IS TRUE);

CREATE OR REPLACE FUNCTION public.enforce_max_5_shipping_addresses()
RETURNS TRIGGER AS $$
DECLARE shipping_count INT;
BEGIN
  IF NEW.type = 'shipping' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT COUNT(*) INTO shipping_count
      FROM public.addresses
      WHERE "userId" = NEW."userId" AND type = 'shipping';
      IF shipping_count >= 5 THEN
        RAISE EXCEPTION 'Límite alcanzado: máximo 5 direcciones de envío por usuario.';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF COALESCE(OLD.type,'') <> 'shipping' THEN
        SELECT COUNT(*) INTO shipping_count
        FROM public.addresses
        WHERE "userId" = NEW."userId" AND type = 'shipping';
        IF shipping_count >= 5 THEN
          RAISE EXCEPTION 'Límite alcanzado: máximo 5 direcciones de envío por usuario.';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_addresses_max5_shipping ON public.addresses;
CREATE TRIGGER trg_addresses_max5_shipping
  BEFORE INSERT OR UPDATE ON public.addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_max_5_shipping_addresses();

CREATE OR REPLACE VIEW public.v_reservations_basic AS
SELECT
  r."reservationCode"  AS "reservationId",
  r."peopleCount",
  r."reservationDate",
  r."reservationTime",
  r."branchId"
FROM public.reservations r;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS "firstNameSalt" TEXT,
  ADD COLUMN IF NOT EXISTS "lastNameSalt" TEXT,
  ADD COLUMN IF NOT EXISTS "phoneSalt" TEXT;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "totalAmount" NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Agrega las columnas faltantes (no pasa nada si ya existen)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS "numPeople" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "reservationCode" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Garantiza unicidad del código (si lo usas) y del horario por sucursal
ALTER TABLE public.reservations
  ALTER COLUMN "reservationCode" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_unique_slot_idx
  ON public.reservations ("branchId", "reservationDate", "reservationTime");

CREATE UNIQUE INDEX IF NOT EXISTS reservations_reservation_code_idx
  ON public.reservations ("reservationCode");

-- Trigger para mantener updatedAt (usa la función ya definida en el script)
DROP TRIGGER IF EXISTS trg_reservations_touch_updated_at ON public.reservations;
CREATE TRIGGER trg_reservations_touch_updated_at
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

  -- Tabla de reservas fallidas (se crea si no existe)
CREATE TABLE IF NOT EXISTS public.reservation_failures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "originalReservationId" UUID NOT NULL UNIQUE,
  "userId" TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "reservationCode" TEXT,
  "reservationDate" DATE NOT NULL,
  "reservationTime" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "branchNumber" TEXT,
  "peopleCount" INTEGER NOT NULL,
  message TEXT,
  "preOrderItems" TEXT,
  "linkedOrderId" TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "cleanupAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS reservation_failures_user_idx
  ON public.reservation_failures ("userId");

CREATE INDEX IF NOT EXISTS reservation_failures_cleanup_idx
  ON public.reservation_failures ("cleanupAt");

-- Columnas adicionales para la tabla principal de reservaciones
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS "preOrderItems" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedOrderId" TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "branchNumber" TEXT;

-- ==========================================================
-- 1) Registro de consumo por cliente
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.customer_consumption (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId"      TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "orderId"     TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  "reservationId" TEXT REFERENCES public.reservations(id) ON DELETE SET NULL,
  category      TEXT NOT NULL CHECK (category IN ('beverage','food','other')),
  quantity      NUMERIC(10,2) NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'pos',
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_consumption_user_idx ON public.customer_consumption ("userId");
CREATE INDEX IF NOT EXISTS customer_consumption_order_idx ON public.customer_consumption ("orderId");
CREATE INDEX IF NOT EXISTS customer_consumption_reservation_idx ON public.customer_consumption ("reservationId");

-- ==========================================================
-- 2) Actualizar estados (pending/past/completed)
--    Ejecutar diariamente después del corte MX (23:59)
-- ==========================================================
-- Past due orders
WITH ref AS (
  SELECT timezone('America/Mexico_City', NOW())::date AS ref_day
)
UPDATE public.orders o
SET status = 'past', "updatedAt" = NOW()
FROM ref
WHERE o.status = 'pending'
  AND o."createdAt" < (ref.ref_day::timestamp + INTERVAL '23 hours 59 minutes 59 seconds');

-- Past due reservations
WITH ref AS (
  SELECT timezone('America/Mexico_City', NOW())::date AS ref_day
)
UPDATE public.reservations r
SET status = 'past', "updatedAt" = NOW()
FROM ref
WHERE r.status = 'pending'
  AND (r."reservationDate" < ref.ref_day
       OR (r."reservationDate" = ref.ref_day AND r."reservationTime" <= TIME '23:59:59'));

-- Marcar completados manualmente
UPDATE public.orders
SET status = 'completed', "updatedAt" = NOW()
WHERE id = '<<order-id>>';

UPDATE public.reservations
SET status = 'completed', "updatedAt" = NOW()
WHERE id = '<<reservation-id>>';


-- Extensión por si aún no estaba habilitada
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla principal de la cola POS
CREATE TABLE IF NOT EXISTS public.pos_queue_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "orderId"       TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  "orderItemId"   TEXT REFERENCES public.order_items(id) ON DELETE SET NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','cancelled')),
  source          TEXT NOT NULL DEFAULT 'pos',
  payload         JSONB,
  notes           TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "handledByStaffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  "startedAt"     TIMESTAMPTZ,
  "completedAt"   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_queue_entries_order_item_idx
  ON public.pos_queue_entries("orderItemId")
  WHERE "orderItemId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS pos_queue_entries_order_idx
  ON public.pos_queue_entries("orderId");

-- Trigger para mantener updatedAt
CREATE OR REPLACE FUNCTION public.touch_pos_queue_entries()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pos_queue_entries_touch ON public.pos_queue_entries;
CREATE TRIGGER trg_pos_queue_entries_touch
  BEFORE UPDATE ON public.pos_queue_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_pos_queue_entries();


ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS "tipAmount" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "tipPercent" numeric(5,2),
  ADD COLUMN IF NOT EXISTS totals jsonb,
  ADD COLUMN IF NOT EXISTS items jsonb;

-- opcional: default para mantener snapshots aunque el front no los mande
ALTER TABLE public.orders
  ALTER COLUMN totals SET DEFAULT '{}'::jsonb,
  ALTER COLUMN items  SET DEFAULT '[]'::jsonb;


-- crea una secuencia si no existe
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START 1000;

ALTER TABLE public.orders
  ALTER COLUMN "orderNumber" SET DEFAULT to_char(nextval('public.order_number_seq'), 'FM000000');

-- (opcional) rellena las filas existentes sin folio
UPDATE public.orders
SET "orderNumber" = to_char(nextval('public.order_number_seq'), 'FM000000')
WHERE "orderNumber" IS NULL;


-- 1) Extensión necesaria para UUIDs autogenerados
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2) Propinas y snapshots en orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS "tipAmount" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "tipPercent" numeric(5,2),
  ADD COLUMN IF NOT EXISTS totals jsonb,
  ADD COLUMN IF NOT EXISTS items jsonb;

ALTER TABLE public.orders
  ALTER COLUMN totals SET DEFAULT '{}'::jsonb,
  ALTER COLUMN items  SET DEFAULT '[]'::jsonb;

-- 3) Folio autogenerado
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START 1000;

ALTER TABLE public.orders
  ALTER COLUMN "orderNumber" SET DEFAULT to_char(nextval('public.order_number_seq'), 'FM000000');

UPDATE public.orders
SET "orderNumber" = to_char(nextval('public.order_number_seq'), 'FM000000')
WHERE "orderNumber" IS NULL;

-- 4) IDs automáticos en order_items
ALTER TABLE public.order_items
  ALTER COLUMN id SET DEFAULT gen_random_uuid();


-- asegúrate de que la extensión esté habilitada (no pasa nada si ya lo está)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE public.tickets
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE SEQUENCE IF NOT EXISTS public.tickets_id_seq;

ALTER TABLE public.tickets
  ALTER COLUMN id SET DEFAULT nextval('public.tickets_id_seq');

ALTER TABLE public.tickets
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE public.tickets
  ALTER COLUMN "paymentMethod" DROP NOT NULL;


--ALTER TABLE orders ADD COLUMN "queuedPaymentMethod" text;


-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ledger de inventario
CREATE TABLE IF NOT EXISTS public.inventory_stock_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "itemId" TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  "branchId" TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  "voucherType" TEXT NOT NULL CHECK ("voucherType" IN ('purchase','transfer','consumption','adjustment','return')),
  "voucherNo" TEXT,
  "postingDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  "postingTime" TIME NOT NULL DEFAULT CURRENT_TIME,
  "inQty" NUMERIC(12,3) NOT NULL DEFAULT 0,
  "outQty" NUMERIC(12,3) NOT NULL DEFAULT 0,
  "balanceQty" NUMERIC(12,3) NOT NULL DEFAULT 0,
  "valuationRate" NUMERIC(12,4),
  "inValue" NUMERIC(14,4) NOT NULL DEFAULT 0,
  "outValue" NUMERIC(14,4) NOT NULL DEFAULT 0,
  "balanceValue" NUMERIC(14,4) NOT NULL DEFAULT 0,
  "batchNo" TEXT,
  "serialNo" TEXT,
  "isCancelled" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdByStaffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_stock_ledger_item_branch_idx
  ON public.inventory_stock_ledger ("itemId","branchId","postingDate");

CREATE TABLE IF NOT EXISTS public.inventory_stock_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "entryType" TEXT NOT NULL CHECK ("entryType" IN ('purchase','transfer','adjustment','consumption')),
  "fromBranchId" TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  "toBranchId" TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  remarks TEXT,
  "createdByStaffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "submittedAt" TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS public.inventory_stock_entry_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "entryId" UUID NOT NULL REFERENCES public.inventory_stock_entries(id) ON DELETE CASCADE,
  "itemId" TEXT NOT NULL REFERENCES public.inventory_items(id),
  "branchId" TEXT NOT NULL REFERENCES public.branches(id),
  "qty" NUMERIC(12,3) NOT NULL,
  "valuationRate" NUMERIC(12,4),
  "amount" NUMERIC(14,4),
  "relatedOrderItemId" TEXT REFERENCES public.order_items(id) ON DELETE SET NULL
);

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS "lastRestockAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "lastRestockQty" NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS "avgCost" NUMERIC(12,4);

ALTER TABLE public.inventory_stock
  ADD COLUMN IF NOT EXISTS "lastUpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.touch_inventory_stock()
RETURNS TRIGGER AS $$
BEGIN
  NEW."lastUpdatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_stock_touch ON public.inventory_stock;
CREATE TRIGGER trg_inventory_stock_touch
  BEFORE UPDATE ON public.inventory_stock
  FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_stock();

ALTER TABLE public.staff_sessions
  ADD COLUMN IF NOT EXISTS browser TEXT,
  ADD COLUMN IF NOT EXISTS os TEXT,
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT CHECK ("sourceType" IN ('pos','cliente')) DEFAULT 'pos';

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT CHECK ("sourceType" IN ('pos','cliente')) DEFAULT 'cliente';

CREATE TABLE IF NOT EXISTS marketing_cluster_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date timestamptz not null,
  range_key text not null,
  cluster_id text not null,
  centroid jsonb not null,
  customer_count integer not null,
  avg_ticket numeric(10,2) not null
);
create index on marketing_cluster_snapshots (snapshot_date, range_key);

CREATE TABLE IF NOT EXISTS marketing_product_suggestions (
  id uuid primary key default gen_random_uuid(),
  snapshot_date timestamptz not null,
  range_key text not null,
  product_id text not null,
  reason text,
  support_count integer not null
);

CREATE TABLE IF NOT EXISTS marketing_markov_edges (
  id uuid primary key default gen_random_uuid(),
  snapshot_date timestamptz not null,
  range_key text not null,
  from_page text not null,
  to_page text not null,
  probability numeric(6,3) not null
);
create index on marketing_markov_edges (snapshot_date, range_key);

CREATE TABLE IF NOT EXISTS marketing_inventory_insights (
  id uuid primary key default gen_random_uuid(),
  snapshot_date timestamptz not null,
  item_id text not null,
  risk text not null,
  recommendation text not null,
  posterior jsonb
);

CREATE TABLE IF NOT EXISTS marketing_anomalies (
  id uuid primary key default gen_random_uuid(),
  snapshot_date timestamptz not null,
  label text not null,
  description text not null,
  severity text default 'medium'
);

-- Roles extendidos
create table if not exists staff_roles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('barista','gerente','socio','superuser')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tokens de restablecimiento de contraseña
create table if not exists staff_password_resets (
  id uuid primary key default gen_random_uuid(),
  staff_id text references staff_users(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  requested_ip text,
  requested_user_agent text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_password_resets_email_idx on staff_password_resets (email);
create index if not exists staff_password_resets_expires_idx on staff_password_resets (expires_at);
create index if not exists staff_password_resets_unused_idx on staff_password_resets (used_at) where used_at is null;

-- Sembrado idempotente de socios en staff_users
insert into staff_users as su (
  id,
  email,
  role,
  "branchId",
  "firstNameEncrypted",
  "lastNameEncrypted",
  is_active
)
values
  ('socio-demo', 'socio.demo@xoco.local', 'socio', 'MATRIZ', 'Socio', 'Demo', true),
  ('socio-cots', 'cots.21d@gmail.com', 'socio', 'MATRIZ', 'Sergio', 'Cortés', true),
  ('socio-ale', 'aleisgales99@gmail.com', 'socio', 'MATRIZ', 'Alejandro', 'Galván', true),
  ('socio-jhon', 'garcia.aragon.jhon23@gmail.com', 'socio', 'MATRIZ', 'Juan', 'García', true),
  ('socio-donovan', 'donovanriano@gmail.com', 'socio', 'MATRIZ', 'Donovan', 'Riaño', true)
on conflict (email) do update set
  role = excluded.role,
  "branchId" = excluded."branchId",
  "firstNameEncrypted" = coalesce(excluded."firstNameEncrypted", su."firstNameEncrypted"),
  "lastNameEncrypted" = coalesce(excluded."lastNameEncrypted", su."lastNameEncrypted"),
  is_active = true;

-- Perfil extendido con campos cifrados (AES-GCM). Se guardan como texto base16.
alter table if exists staff_profiles
  add column if not exists encrypted_salary text,
  add column if not exists encrypted_tip_pool text,
  add column if not exists encrypted_paid_leave_days text,
  add column if not exists encrypted_admin_faults text,
  add column if not exists encrypted_branch_assignment text,
  add column if not exists encrypted_position text,
  add column if not exists encrypted_comments text;

-- Requests de gobernanza
create table if not exists staff_governance_requests (
  id uuid primary key default gen_random_uuid(),
  employee_email text not null,
  branch_id text,
  type text not null check (type in (
    'salary','role','branch','manager','termination','branch-edit','inventory','evaluation'
  )),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','requires_changes','approved','declined')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deadline timestamptz not null default (now() + interval '5 days')
);

create table if not exists staff_governance_votes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references staff_governance_requests(id) on delete cascade,
  reviewer_email text not null,
  decision text not null default 'pending' check (decision in ('pending','approved','declined')),
  comment text,
  decided_at timestamptz,
  constraint unique_reviewer_per_request unique (request_id, reviewer_email)
);

-- Tabla de aprobaciones operativas (goce de sueldo, limpieza, evaluaciones)
create table if not exists staff_approvals (
  id uuid primary key default gen_random_uuid(),
  employee_email text not null,
  category text not null check (category in ('paid_leave','cleaning','comments','performance')),
  note text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  due_date date not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Auditoría de inventarios editados por socios/gerentes
create table if not exists inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  item_name text not null,
  previous_quantity numeric not null,
  new_quantity numeric not null,
  branch_id text,
  edited_by text not null,
  request_id uuid references staff_governance_requests(id),
  created_at timestamptz not null default now()
);

-- Control de super usuarios
create table if not exists staff_superusers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Comentarios de evaluaciones (cifrado en frontend)
create table if not exists staff_evaluations (
  id uuid primary key default gen_random_uuid(),
  employee_email text not null,
  reviewer_email text not null,
  encrypted_comment text not null,
  score numeric(3,1),
  created_at timestamptz not null default now()
);

-- Trigger para actualizar updated_at en governance
create or replace function touch_staff_governance_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_governance on staff_governance_requests;
create trigger trg_touch_governance
before update on staff_governance_requests
for each row execute procedure touch_staff_governance_updated_at();

-- Vista rápida para dashboard
create or replace view view_staff_governance_dashboard as
select
  r.id,
  r.employee_email,
  r.branch_id,
  r.type,
  r.status,
  r.deadline,
  r.payload,
  r.created_by,
  r.created_at,
  jsonb_agg(
    jsonb_build_object(
      'reviewer', v.reviewer_email,
      'decision', v.decision,
      'comment', v.comment,
      'decided_at', v.decided_at
    )
  ) as approvals
from staff_governance_requests r
left join staff_governance_votes v on v.request_id = r.id
group by r.id;

-- --------------------------------------------------------------------
--  Pedidos - metadatos adicionales usados por el POS
-- --------------------------------------------------------------------
alter table if exists public.orders
  add column if not exists metadata jsonb,
  add column if not exists notes text,
  add column if not exists message text,
  add column if not exists instructions text;

-- --------------------------------------------------------------------
--  Marketing analytics (idempotent setup to avoid 42P07 errors)
-- --------------------------------------------------------------------
do $$
begin
  if to_regclass('public.marketing_cluster_snapshots') is null then
    create table public.marketing_cluster_snapshots (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      range_key text not null,
      cluster_id text not null,
      centroid jsonb not null,
      customer_count integer not null,
      avg_ticket numeric(10,2) not null
    );
  end if;
end$$;

create index if not exists marketing_cluster_snapshots_snapshot_range_idx
  on marketing_cluster_snapshots (snapshot_date, range_key);

do $$
begin
  if to_regclass('public.marketing_product_suggestions') is null then
    create table public.marketing_product_suggestions (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      range_key text not null,
      product_id text not null,
      reason text,
      support_count integer not null
    );
  end if;
end$$;

do $$
begin
  if to_regclass('public.marketing_markov_edges') is null then
    create table public.marketing_markov_edges (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      range_key text not null,
      from_page text not null,
      to_page text not null,
      probability numeric(6,3) not null
    );
  end if;
end$$;

create index if not exists marketing_markov_edges_snapshot_range_idx
  on marketing_markov_edges (snapshot_date, range_key);

do $$
begin
  if to_regclass('public.marketing_inventory_insights') is null then
    create table public.marketing_inventory_insights (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      item_id text not null,
      risk text not null,
      recommendation text not null,
      posterior jsonb
    );
  end if;
end$$;

do $$
begin
  if to_regclass('public.marketing_anomalies') is null then
    create table public.marketing_anomalies (
      id uuid primary key default gen_random_uuid(),
      snapshot_date timestamptz not null,
      label text not null,
      description text not null,
      severity text default 'medium'
    );
  end if;
end$$;


CREATE OR REPLACE FUNCTION public.enforce_address_limit()
RETURNS trigger AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM public.addresses WHERE "userId" = NEW."userId"
  ) >= 3 THEN
    RAISE EXCEPTION 'Solo puedes registrar 3 direcciones por usuario';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_addresses_limit ON public.addresses;
CREATE TRIGGER trg_addresses_limit
BEFORE INSERT ON public.addresses
FOR EACH ROW EXECUTE FUNCTION public.enforce_address_limit();


-- Datos adicionales por pedido: cliente público y contacto
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS pos_customer_id text DEFAULT 'AAA-1111',
  ADD COLUMN IF NOT EXISTS shipping_contact_phone text,
  ADD COLUMN IF NOT EXISTS shipping_contact_is_whatsapp boolean DEFAULT false;

-- Si userId era NOT NULL, permite nulos para órdenes invitadas
ALTER TABLE public.orders
  ALTER COLUMN "userId" DROP NOT NULL;

-- Backfill de números capturados en el JSON original
UPDATE public.orders
SET shipping_contact_phone = items->'shipping'->>'contactPhone',
    shipping_contact_is_whatsapp = COALESCE((items->'shipping'->>'isWhatsapp')::boolean, false)
WHERE items ? 'shipping'
  AND (shipping_contact_phone IS NULL OR shipping_contact_phone = '');

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address_id text,
  ADD COLUMN IF NOT EXISTS delivery_tip_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS delivery_tip_percent numeric(5,2);

DO $$
BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_shipping_address_id_fkey
    FOREIGN KEY (shipping_address_id) REFERENCES addresses(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;


DO $$
DECLARE fk_name TEXT;
BEGIN
  SELECT constraint_name
  INTO fk_name
  FROM information_schema.table_constraints
  WHERE table_schema='public'
    AND table_name='shipments'
    AND constraint_type='FOREIGN KEY'
    AND constraint_name ILIKE 'shipments%address%fkey'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.shipments DROP CONSTRAINT %I', fk_name);
  END IF;
END$$;


-- Normaliza todo lo que no sea UUID
UPDATE public.shipments
SET "addressId" = NULL
WHERE "addressId" IS NOT NULL
  AND NOT (
    trim("addressId"::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- (opcional) verifica si quedó algún valor inválido
SELECT DISTINCT "addressId"
FROM public.shipments
WHERE "addressId" IS NOT NULL
  AND NOT (
    "addressId"::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );


ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_percent numeric(5,2);

-- opcional: llena los valores existentes a partir del JSON totals
UPDATE public.orders
SET subtotal = COALESCE(subtotal, (totals->>'subtotal')::numeric),
    vat_amount = COALESCE(vat_amount, (totals->>'vat')::numeric),
    vat_percent = COALESCE(vat_percent, (totals->>'vatPercent')::numeric);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS "deliveryTipAmount" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "deliveryTipPercent" numeric(5,2);

-- si también quieres tenerlas accesibles en minúsculas para SQL plano
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_tip_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS delivery_tip_percent numeric(5,2);

-- opcional: sincroniza ambos pares mientras definimos cuál conservar
UPDATE public.orders
SET "deliveryTipAmount" = COALESCE("deliveryTipAmount", delivery_tip_amount),
    "deliveryTipPercent" = COALESCE("deliveryTipPercent", delivery_tip_percent),
    delivery_tip_amount = COALESCE(delivery_tip_amount, "deliveryTipAmount"),
    delivery_tip_percent = COALESCE(delivery_tip_percent, "deliveryTipPercent");


ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS "loyaltyActivatedAt" timestamptz;

UPDATE public.users u
SET "loyaltyActivatedAt" = lp.created_at
FROM (
  SELECT "userId", MIN("createdAt") AS created_at
  FROM public.loyalty_points
  GROUP BY "userId"
) lp
WHERE u.id = lp."userId"
  AND u."loyaltyActivatedAt" IS NULL;

-- 1. Bitácora de Higiene (Baños, Cocina, Área Común)
CREATE TABLE IF NOT EXISTS public.hygiene_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "area" TEXT NOT NULL CHECK (area IN ('BAÑO', 'COCINA', 'BARRA', 'MESAS')),
  "staffId" TEXT REFERENCES public.staff_users(id),
  "is_clean" BOOLEAN DEFAULT TRUE,
  "supplies_refilled" BOOLEAN DEFAULT TRUE, -- Papel, jabón, gel
  "observations" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Control de Plagas (Documentación NOM-251)
CREATE TABLE IF NOT EXISTS public.pest_control_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_date" DATE NOT NULL,
  "provider_name" TEXT,
  "certificate_number" TEXT, -- Folio del certificado de fumigación
  "next_service_date" DATE,
  "staffId" TEXT REFERENCES public.staff_users(id),
  "observations" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Bitácora de residuos y limpieza profunda
CREATE TABLE IF NOT EXISTS public.waste_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organicBeveragesKg" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "organicFoodsKg" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "inorganicKg" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "trashRemoved" BOOLEAN NOT NULL DEFAULT FALSE,
  "binsWashed" BOOLEAN NOT NULL DEFAULT FALSE,
  "branchId" TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  "staffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Recetas (Unión Venta-Inventario)
CREATE TABLE IF NOT EXISTS public.product_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  "inventoryItemId" TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  "quantityUsed" NUMERIC(12,3) NOT NULL, -- Gramos o ml
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Banderas de Stock para App de Clientes
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS "is_low_stock" BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS "out_of_stock_reason" TEXT;


-- 1. Eliminar la tabla antigua para recrearla limpia con la nueva estructura
DROP TABLE IF EXISTS public.addresses CASCADE;

-- 2. Crear la tabla con soporte para encriptación
CREATE TABLE public.addresses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "userId" TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  nickname TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL, -- Aquí irán street, city, etc. encriptados
  payload_iv TEXT NOT NULL,
  payload_tag TEXT NOT NULL,
  payload_salt TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Índices y Triggers (necesarios para el funcionamiento)
CREATE INDEX IF NOT EXISTS addresses_user_id_idx ON public.addresses ("userId");

DROP TRIGGER IF EXISTS trg_addresses_touch_updated_at ON public.addresses;
CREATE TRIGGER trg_addresses_touch_updated_at
  BEFORE UPDATE ON public.addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_users_updated_at();

ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS metadata JSONB,
ADD COLUMN IF NOT EXISTS items JSONB;

-- 1. Bitácora de Higiene (Baños, Cocina, Área Común)
CREATE TABLE IF NOT EXISTS public.hygiene_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "area" TEXT NOT NULL CHECK (area IN ('BAÑO', 'COCINA', 'BARRA', 'MESAS')),
  "staffId" TEXT REFERENCES public.staff_users(id),
  "is_clean" BOOLEAN DEFAULT TRUE,
  "supplies_refilled" BOOLEAN DEFAULT TRUE, -- Papel, jabón, gel
  "observations" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Control de Plagas (Documentación NOM-251)
CREATE TABLE IF NOT EXISTS public.pest_control_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_date" DATE NOT NULL,
  "provider_name" TEXT,
  "certificate_number" TEXT, -- Folio del certificado de fumigación
  "next_service_date" DATE,
  "staffId" TEXT REFERENCES public.staff_users(id),
  "observations" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Bitácora de residuos y limpieza profunda
CREATE TABLE IF NOT EXISTS public.waste_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organicBeveragesKg" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "organicFoodsKg" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "inorganicKg" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "trashRemoved" BOOLEAN NOT NULL DEFAULT FALSE,
  "binsWashed" BOOLEAN NOT NULL DEFAULT FALSE,
  "branchId" TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  "staffId" TEXT REFERENCES public.staff_users(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Recetas (Unión Venta-Inventario)
CREATE TABLE IF NOT EXISTS public.product_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId" TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  "inventoryItemId" TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  "quantityUsed" NUMERIC(12,3) NOT NULL, -- Gramos o ml
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Banderas de Stock para App de Clientes
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS "is_low_stock" BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS "out_of_stock_reason" TEXT,
ADD COLUMN IF NOT EXISTS "manualStockStatus" TEXT DEFAULT 'normal'
  CHECK ("manualStockStatus" IN ('normal','low','out')),
ADD COLUMN IF NOT EXISTS "manualStockReason" TEXT,
ADD COLUMN IF NOT EXISTS "manualStatusUpdatedAt" TIMESTAMPTZ;
