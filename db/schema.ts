import { pgTable, text, boolean, timestamp, integer, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core';
export const profiles = pgTable('profiles', {
 id: text('id').primaryKey(), email: text('email').notNull().unique(), name: text('name').notNull(),
 blocked: boolean('blocked').notNull().default(false), deleted: boolean('deleted').notNull().default(false),
 mustChangePassword: boolean('must_change_password').notNull().default(true),
 createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow()
});
export const sessions = pgTable('sessions', {
 hash: text('hash').primaryKey(), userId: text('user_id').notNull().references(()=>profiles.id),
 expiresAt: timestamp('expires_at', {withTimezone:true}).notNull(), createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow()
}, t=>[index('sessions_user_idx').on(t.userId)]);
export const charges = pgTable('charges', {
 id: text('id').primaryKey(), creatorId: text('creator_id').notNull().references(()=>profiles.id),
 requestKey: text('request_key').notNull(), fingerprint: text('fingerprint').notNull(), amount: integer('amount').notNull(),
 orderId: text('order_id').unique(), qrCode: text('qr_code'), status: text('status').notNull().default('creating'),
 providerStatus: text('provider_status'), expiresAt: timestamp('expires_at', {withTimezone:true}),
 paidAt: timestamp('paid_at', {withTimezone:true}), checkedAt: timestamp('checked_at', {withTimezone:true}),
 createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow()
}, t=>[uniqueIndex('charges_request_idx').on(t.creatorId,t.requestKey),index('charges_creator_idx').on(t.creatorId),index('charges_status_idx').on(t.status)]);
export const audit = pgTable('audit_events', {
 id: text('id').primaryKey(), actorId: text('actor_id').notNull(), action: text('action').notNull(),
 targetId: text('target_id'), details: jsonb('details'), createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow()
});
export const rateLimits = pgTable('rate_limits', {
 key: text('key').primaryKey(), attempts: integer('attempts').notNull().default(1),
 resetsAt: timestamp('resets_at', {withTimezone:true}).notNull()
});
