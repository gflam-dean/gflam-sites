--
-- PostgreSQL database dump (fixture, made up)
--
\restrict abc123
SET statement_timeout = 0;
SET transaction_timeout = 0;
SELECT pg_catalog.set_config('search_path', '', false);
CREATE SCHEMA "public";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
CREATE TABLE "public"."vp_venues" ("id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL, "slug" "text" NOT NULL);
ALTER TABLE "public"."vp_venues" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE "public"."vp_venues" TO "anon";
\unrestrict abc123
