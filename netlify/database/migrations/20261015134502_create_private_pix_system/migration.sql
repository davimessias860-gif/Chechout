CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" text PRIMARY KEY,
	"creator_id" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"amount" integer NOT NULL,
	"order_id" text UNIQUE,
	"qr_code" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"provider_status" text,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY,
	"attempts" integer DEFAULT 1 NOT NULL,
	"resets_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"hash" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "charges_request_idx" ON "charges" ("creator_id","request_key");--> statement-breakpoint
CREATE INDEX "charges_creator_idx" ON "charges" ("creator_id");--> statement-breakpoint
CREATE INDEX "charges_status_idx" ON "charges" ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" ("user_id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_creator_id_profiles_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "profiles"("id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_profiles_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id");