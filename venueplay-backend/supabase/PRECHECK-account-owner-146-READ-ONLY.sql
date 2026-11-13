-- =====================================================================
-- PRE-CHECK FOR MIGRATION 146 (READ ONLY: nothing here writes anything)
-- ---------------------------------------------------------------------
-- Security audit 3 Nov 2026, finding H2. Run this BEFORE migration 146 and read it.
--
-- One row per login per account (owner and manager staff rows only; hosts are never owners).
--   currently_has_owner_rights  what today's billing Worker gives them: yes for every login
--                               with no permissions object (the hole)
--   becomes_owner               what they will have once 146 and the new Worker are both live
--   owner_rule                  why. A 'GUESSED' row is an account where no login is role owner
--                               and none matches the account's contact email or mobile, so the
--                               earliest full-access login was picked: CHECK THOSE BY NAME.
--   change                      'LOSES owner rights' rows are the ones the hole was giving owner
--                               rights to. Expect duty managers and old hosts stored as managers.
--
-- Run the two queries one at a time (highlight one, then Run). The first is the summary.
-- =====================================================================

-- 1. SUMMARY: how many logins change, and any account left with no owner.
-- >>> WHO IS EACH ACCOUNT'S OWNER (the same block in venueplay-146 and PRECHECK-146; a test holds them together)
with staff_on_account as (
  select v.founding_id, s.auth_user_id, s.role, s.permissions, v.name as venue_name
    from public.vp_venue_staff s
    join public.vp_venues v on v.id = s.venue_id
   where s.role in ('owner', 'manager')
     and v.founding_id is not null
     and s.auth_user_id is not null
),
logins as (
  select a.founding_id, a.auth_user_id,
         bool_or(a.role = 'owner')                  as has_owner_role,
         bool_and(a.permissions is null)            as no_restrictions,
         string_agg(distinct a.venue_name, ', ')    as venues
    from staff_on_account a
   group by a.founding_id, a.auth_user_id
),
matched as (
  select l.founding_id, l.auth_user_id, l.has_owner_role, l.no_restrictions, l.venues,
         u.email as login_email, u.phone as login_phone, u.created_at as login_created,
         f.contact_email, f.mobile as account_mobile,
         (l.no_restrictions and (
             (u.email is not null and f.contact_email is not null
              and lower(trim(u.email)) = lower(trim(f.contact_email)))
          or (length(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')) >= 9
              and length(regexp_replace(coalesce(f.mobile, ''), '[^0-9]', '', 'g')) >= 9
              and right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 9)
                = right(regexp_replace(f.mobile, '[^0-9]', '', 'g'), 9))
         )) as matches_account_contact
    from logins l
    join public.venueplay_founding f on f.id = l.founding_id
    left join auth.users u on u.id = l.auth_user_id
),
ranked as (
  select m.*,
         bool_or(m.has_owner_role or m.matches_account_contact)
           over (partition by m.founding_id) as account_has_clear_owner,
         row_number() over (partition by m.founding_id
                            order by (not m.no_restrictions), m.login_created nulls last, m.auth_user_id) as fallback_rank
    from matched m
),
decided as (
  select r.*,
         case when r.has_owner_role then 'role owner'
              when r.matches_account_contact then 'login matches the account contact email or mobile'
              when (not r.account_has_clear_owner) and r.no_restrictions and r.fallback_rank = 1
                then 'GUESSED: earliest full-access login on an account with no clear owner (check this one)'
              else null end as owner_rule
    from ranked r
)
-- <<< end of the shared block
select coalesce(change, 'TOTAL') as change, count(*) as logins
  from (select case when d.owner_rule is not null and d.no_restrictions then 'keeps owner rights'
                    when d.owner_rule is not null then 'GAINS owner rights (role owner with a permissions object)'
                    when d.no_restrictions then 'LOSES owner rights'
                    else 'unchanged (restricted manager)' end as change
          from decided d) x
 group by rollup (change)
union all
select 'ACCOUNTS WITH NO OWNER AFTER 146 (should be 0 unless every login there is restricted)',
       count(*)
  from (select founding_id from decided group by founding_id having bool_and(owner_rule is null)) y
union all
select 'accounts where the owner was GUESSED (check by name below)',
       count(distinct founding_id)
  from decided where owner_rule like 'GUESSED%';

-- 2. EVERY LOGIN: who becomes the owner of each account, and who loses owner rights.
-- >>> WHO IS EACH ACCOUNT'S OWNER (the same block in venueplay-146 and PRECHECK-146; a test holds them together)
with staff_on_account as (
  select v.founding_id, s.auth_user_id, s.role, s.permissions, v.name as venue_name
    from public.vp_venue_staff s
    join public.vp_venues v on v.id = s.venue_id
   where s.role in ('owner', 'manager')
     and v.founding_id is not null
     and s.auth_user_id is not null
),
logins as (
  select a.founding_id, a.auth_user_id,
         bool_or(a.role = 'owner')                  as has_owner_role,
         bool_and(a.permissions is null)            as no_restrictions,
         string_agg(distinct a.venue_name, ', ')    as venues
    from staff_on_account a
   group by a.founding_id, a.auth_user_id
),
matched as (
  select l.founding_id, l.auth_user_id, l.has_owner_role, l.no_restrictions, l.venues,
         u.email as login_email, u.phone as login_phone, u.created_at as login_created,
         f.contact_email, f.mobile as account_mobile,
         (l.no_restrictions and (
             (u.email is not null and f.contact_email is not null
              and lower(trim(u.email)) = lower(trim(f.contact_email)))
          or (length(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g')) >= 9
              and length(regexp_replace(coalesce(f.mobile, ''), '[^0-9]', '', 'g')) >= 9
              and right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 9)
                = right(regexp_replace(f.mobile, '[^0-9]', '', 'g'), 9))
         )) as matches_account_contact
    from logins l
    join public.venueplay_founding f on f.id = l.founding_id
    left join auth.users u on u.id = l.auth_user_id
),
ranked as (
  select m.*,
         bool_or(m.has_owner_role or m.matches_account_contact)
           over (partition by m.founding_id) as account_has_clear_owner,
         row_number() over (partition by m.founding_id
                            order by (not m.no_restrictions), m.login_created nulls last, m.auth_user_id) as fallback_rank
    from matched m
),
decided as (
  select r.*,
         case when r.has_owner_role then 'role owner'
              when r.matches_account_contact then 'login matches the account contact email or mobile'
              when (not r.account_has_clear_owner) and r.no_restrictions and r.fallback_rank = 1
                then 'GUESSED: earliest full-access login on an account with no clear owner (check this one)'
              else null end as owner_rule
    from ranked r
)
-- <<< end of the shared block
select d.founding_id                                   as account,
       d.contact_email                                 as account_contact,
       d.venues,
       coalesce(d.login_email, '(no email)')           as login_email,
       case when d.login_phone is null then null
            else '...' || right(d.login_phone, 3) end  as login_mobile_end,
       case when d.has_owner_role then 'owner' else 'manager' end as role,
       d.no_restrictions                               as currently_has_owner_rights,
       (d.owner_rule is not null)                      as becomes_owner,
       d.owner_rule,
       case when d.owner_rule is not null and d.no_restrictions then 'keeps owner rights'
            when d.owner_rule is not null then 'GAINS owner rights'
            when d.no_restrictions then 'LOSES owner rights'
            else 'unchanged' end                       as change
  from decided d
 order by d.contact_email, (d.owner_rule is null), d.login_email;
