import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Wraps async route handlers so rejected promises reach the error handler.
export const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function requireApiKey(req, res, next) {
  const given = Buffer.from(req.get('x-api-key') || '');
  const expected = Buffer.from(config.apiKey || '');
  if (!config.apiKey || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return next(new HttpError(401, 'missing or invalid x-api-key header'));
  }
  next();
}

export function notFound(req, res, next) {
  next(new HttpError(404, `no route for ${req.method} ${req.path}`));
}

export function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let body = { error: err.message, details: err.details };
  if (err.code === 11000) {
    status = 409;
    body = { error: 'duplicate key', details: err.keyValue };
  } else if (err.code === 121) {
    status = 400;
    body = { error: 'document failed schema validation', details: err.errInfo?.details };
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    body = { error: 'request body is not valid JSON' };
  }
  if (status >= 500) {
    console.error(err);
    body = { error: 'internal server error' };
  }
  res.status(status).json(body);
}

// Query-string helpers
export function parseDate(value, name) {
  if (value === undefined) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} must be an ISO-8601 date`);
  return d;
}

export function parseLimit(value, fallback = 100, max = 1000) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new HttpError(400, `limit must be an integer 1..${max}`);
  return n;
}

// Default reporting window: the last 7 days.
export function dateRange(query) {
  const to = parseDate(query.to, 'to') ?? new Date();
  const from = parseDate(query.from, 'from') ?? new Date(to.getTime() - 7 * 86_400_000);
  if (from >= to) throw new HttpError(400, 'from must be before to');
  return { from, to };
}

// Only allow the listed fields through from a request body.
export function pick(body, fields) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'body must be a JSON object');
  return Object.fromEntries(fields.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));
}
