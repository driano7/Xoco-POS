import type { Order, Reservation } from '@/lib/api';

const CUTOFF_HOUR = 23;
const CUTOFF_MINUTE = 59;
const CUTOFF_SECOND = 59;
const CUTOFF_MS = 999;
const PAST_HIDE_DAYS = 3;
const PAST_PURGE_DAYS = 365;
const PAST_HIDE_MS = PAST_HIDE_DAYS * 24 * 60 * 60 * 1000;
const PAST_PURGE_MS = PAST_PURGE_DAYS * 24 * 60 * 60 * 1000;

const setEndOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(CUTOFF_HOUR, CUTOFF_MINUTE, CUTOFF_SECOND, CUTOFF_MS);
  return copy;
};

const parseLocalDate = (dateStr: string, time?: string | null) => {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const timeParts = (time ?? '').split(':');
  const hour = Number(timeParts[0]);
  const minute = Number(timeParts[1]);
  const second = Number(timeParts[2]);

  const date = new Date(
    year,
    month - 1,
    day,
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    Number.isFinite(second) ? second : 0
  );

  return Number.isNaN(date.getTime()) ? null : date;
};

const parseIso = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const cutoffFromIso = (value?: string | null) => {
  const parsed = parseIso(value);
  return parsed ? setEndOfDay(parsed) : null;
};

const getOrderCutoff = (order: Order) => cutoffFromIso(order.createdAt ?? order.updatedAt ?? null);

const getReservationCutoff = (reservation: Reservation) => {
  if (reservation.reservationDate) {
    const parsed = parseLocalDate(reservation.reservationDate, reservation.reservationTime);
    if (parsed) {
      return setEndOfDay(parsed);
    }
  }
  return cutoffFromIso(reservation.createdAt ?? reservation.updatedAt ?? null);
};

const deriveOrderStatus = (order: Order, now: Date) => {
  const currentStatus = order.status ?? 'pending';
  if (currentStatus !== 'pending') {
    return currentStatus;
  }
  const cutoff = getOrderCutoff(order);
  if (cutoff && now > cutoff) {
    return 'past';
  }
  return 'pending';
};

const deriveReservationStatus = (reservation: Reservation, now: Date) => {
  const status = (reservation.status ?? 'pending').toLowerCase();
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'cancelled') {
    return 'past';
  }
  const cutoff = getReservationCutoff(reservation);
  if (cutoff && now > cutoff) {
    return 'past';
  }
  return 'pending';
};

const isOlderThan = (timestamp?: string | null, thresholdMs?: number, now = new Date()) => {
  if (!thresholdMs) {
    return false;
  }
  const parsed = parseIso(timestamp);
  if (!parsed) {
    return false;
  }
  return now.getTime() - parsed.getTime() > thresholdMs;
};

const shouldHidePastOrder = (order: Order, now: Date) =>
  order.status === 'past' && isOlderThan(order.updatedAt ?? order.createdAt, PAST_HIDE_MS, now);

const shouldPurgePastOrder = (order: Order, now: Date) =>
  order.status === 'past' && isOlderThan(order.updatedAt ?? order.createdAt, PAST_PURGE_MS, now);

const shouldHidePastReservation = (reservation: Reservation, now: Date) =>
  (reservation.status === 'past' || reservation.status === 'cancelled') &&
  isOlderThan(reservation.updatedAt ?? reservation.createdAt, PAST_HIDE_MS, now);

const shouldPurgePastReservation = (reservation: Reservation, now: Date) =>
  (reservation.status === 'past' || reservation.status === 'cancelled') &&
  isOlderThan(reservation.updatedAt ?? reservation.createdAt, PAST_PURGE_MS, now);

const annotateHiddenFlag = <T extends { isHidden?: boolean }>(record: T, hidden: boolean): T => {
  if (record.isHidden === hidden) {
    return record;
  }
  return { ...record, isHidden: hidden };
};

export const applyOrderStatusRules = (orders: Order[], now = new Date()): Order[] =>
  orders.map((order) => {
    const nextStatus = deriveOrderStatus(order, now);
    if (nextStatus === order.status) {
      return order;
    }
    return { ...order, status: nextStatus as Order['status'] };
  });

export const applyReservationStatusRules = (reservations: Reservation[], now = new Date()) =>
  reservations.map((reservation) => {
    const nextStatus = deriveReservationStatus(reservation, now);
    return reservation.status === nextStatus ? reservation : { ...reservation, status: nextStatus };
  });

export const purgeExpiredPastOrders = (orders: Order[], now = new Date()) =>
  orders
    .map((order) => annotateHiddenFlag(order, shouldHidePastOrder(order, now)))
    .filter((order) => !shouldPurgePastOrder(order, now));

export const purgeExpiredPastReservations = (reservations: Reservation[], now = new Date()) =>
  reservations
    .map((reservation) => annotateHiddenFlag(reservation, shouldHidePastReservation(reservation, now)))
    .filter((reservation) => !shouldPurgePastReservation(reservation, now));
