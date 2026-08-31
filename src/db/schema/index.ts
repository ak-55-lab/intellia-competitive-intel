import { relations } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

export const roleEnum = pgEnum("role", ["seller", "pm", "admin"]);
export const tierEnum = pgEnum("source_tier", ["A", "B", "C", "D", "INF"]);
export const statusEnum = pgEnum("workflow_status", ["draft", "pending", "approved", "rejected", "published", "archived"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  role: roleEnum("role").notNull(),
  ...timestamps
});

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  website: text("website"),
  ...timestamps
});

export const competitors = pgTable("competitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  website: text("website"),
  segment: text("segment").notNull(),
  summary: text("summary"),
  ...timestamps
});

export const competitorRegions = pgTable("competitor_regions", {
  id: uuid("id").primaryKey().defaultRandom(),
  competitorId: uuid("competitor_id").references(() => competitors.id).notNull(),
  region: text("region").notNull(),
  relevanceScore: integer("relevance_score").notNull(),
  marketPresence: text("market_presence").notNull(),
  notes: text("notes"),
  ...timestamps
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  competitorId: uuid("competitor_id").references(() => competitors.id),
  name: text("name").notNull(),
  ...timestamps
});

export const capabilities = pgTable("capabilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  ...timestamps
});

export const companyCapabilities = pgTable("company_capabilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id).notNull(),
  capabilityId: uuid("capability_id").references(() => capabilities.id).notNull(),
  strength: text("strength").notNull(),
  ...timestamps
});

export const competitorCapabilities = pgTable("competitor_capabilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  competitorId: uuid("competitor_id").references(() => competitors.id).notNull(),
  capabilityId: uuid("capability_id").references(() => capabilities.id).notNull(),
  claimedStrength: text("claimed_strength").notNull(),
  ...timestamps
});

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  competitorId: uuid("competitor_id").references(() => competitors.id),
  companyId: uuid("company_id").references(() => companies.id),
  url: text("url").notNull(),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull(),
  sourceTier: tierEnum("source_tier").notNull(),
  region: text("region").notNull(),
  authorityScore: real("authority_score").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  status: statusEnum("status").default("draft").notNull(),
  ...timestamps
});

export const sourceSnapshots = pgTable("source_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id").references(() => sources.id).notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  ...timestamps
});

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  predicate: text("predicate").notNull(),
  value: text("value").notNull(),
  claimType: text("claim_type").notNull(),
  region: text("region").notNull(),
  confidence: real("confidence").notNull(),
  status: statusEnum("status").default("draft").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  ...timestamps
});

export const claimSources = pgTable("claim_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").references(() => claims.id).notNull(),
  sourceId: uuid("source_id").references(() => sources.id).notNull(),
  ...timestamps
});

export const changes = pgTable("changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  competitorId: uuid("competitor_id").references(() => competitors.id).notNull(),
  sourceId: uuid("source_id").references(() => sources.id),
  region: text("region").notNull(),
  oldSnapshotId: uuid("old_snapshot_id"),
  newSnapshotId: uuid("new_snapshot_id"),
  diffSummary: text("diff_summary").notNull(),
  materiality: text("materiality").notNull(),
  confidence: real("confidence").notNull(),
  status: statusEnum("status").default("pending").notNull(),
  ...timestamps
});

export const recommendations = pgTable("recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  changeId: uuid("change_id").references(() => changes.id),
  competitorId: uuid("competitor_id").references(() => competitors.id).notNull(),
  region: text("region").notNull(),
  recommendationType: text("recommendation_type").notNull(),
  rationale: text("rationale").notNull(),
  suggestedContent: text("suggested_content").notNull(),
  confidence: real("confidence").notNull(),
  status: statusEnum("status").default("pending").notNull(),
  ...timestamps
});

export const battlecards = pgTable("battlecards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  competitorId: uuid("competitor_id").references(() => competitors.id).notNull(),
  region: text("region").notNull(),
  status: statusEnum("status").default("draft").notNull(),
  publishedVersion: integer("published_version").default(0).notNull(),
  ...timestamps
});

export const battlecardSections = pgTable("battlecard_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  battlecardId: uuid("battlecard_id").references(() => battlecards.id).notNull(),
  sectionKey: text("section_key").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sortOrder: integer("sort_order").notNull(),
  status: statusEnum("status").default("draft").notNull(),
  ...timestamps
});

export const battlecardSectionClaims = pgTable("battlecard_section_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  battlecardSectionId: uuid("battlecard_section_id").references(() => battlecardSections.id).notNull(),
  claimId: uuid("claim_id").references(() => claims.id).notNull(),
  ...timestamps
});

export const battlecardVersions = pgTable("battlecard_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  battlecardId: uuid("battlecard_id").references(() => battlecards.id).notNull(),
  version: integer("version").notNull(),
  snapshotJson: jsonb("snapshot_json").notNull(),
  publishedBy: uuid("published_by").references(() => users.id),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  jobType: text("job_type").notNull(),
  status: text("status").notNull(),
  externalId: text("external_id"),
  payload: jsonb("payload"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps
});

export const researchRuns = pgTable("research_runs", {
  id: text("id").primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  companyWebsite: text("company_website").notNull(),
  companyName: text("company_name").notNull(),
  dataMode: text("data_mode").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
  ...timestamps
});

export const tenantRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  companies: many(companies),
  competitors: many(competitors)
}));
