CREATE TABLE "public_assistant_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "request_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "public_assistant_requests_key_created_at_idx" ON "public_assistant_requests" USING btree ("request_key","created_at");
