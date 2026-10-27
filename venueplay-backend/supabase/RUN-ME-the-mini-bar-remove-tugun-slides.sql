-- =====================================================================
-- DATA FIX, not a migration: take Tugun Bowls Club's promos off The Mini Bar's TV.
-- Found by the audit of 23 Oct 2026. /tv?venue=the-mini-bar was rotating four Tugun
-- Bowls Club menu slides (Tuesday roast $14.90, Thursday 50% off, Friday surf and turf
-- $24.90, Saturday parmi and pints $19.90).
--
-- WHERE THEY CAME FROM. Not from tv.html. The page's built-in slide list is empty
-- (ADS.slides starts []); the four Tugun promos in tv.html live only inside the ?demo=1
-- sales page, which has no venue and fetches nothing. The four slides on The Mini Bar's
-- wall are The Mini Bar's OWN vp_venue_screen row: four files uploaded to its venue-ads
-- folder on 5 August 2026 (the Tugun artwork, used as test content when the slide
-- uploader was being built). Tugun's own wall reads Tugun's own row (five slides
-- uploaded in October 2026, one of them the Drag Bingo Feb 27 poster), and is right.
--
-- TWO WAYS TO FIX IT, pick one:
--
--   (a) The normal path, as The Mini Bar's owner: venueplay.com.au/app/billing
--       > Venue setup > Screen: Remove each of the four slides, Save. The TV updates
--       itself within a few seconds (it broadcasts screen_refresh).
--
--   (b) This SQL, in the Supabase SQL editor, in one go. Idempotent.
-- =====================================================================

-- Before: expect 4 slides, every image_url under venue-ads/876b2667-...
select venue_id, slug, jsonb_array_length(slides) as slide_count, updated_at
  from public.vp_venue_screen
 where venue_id = '876b2667-8eec-43ff-b100-58fe3daa8462';   -- The Mini Bar (slug the-mini-bar)

update public.vp_venue_screen
   set slides = '[]'::jsonb,
       updated_at = now()
 where venue_id = '876b2667-8eec-43ff-b100-58fe3daa8462'
   and slug = 'the-mini-bar';

-- After: expect slide_count 0. The wall then shows the venue-neutral holding slide
-- ("Game on here") and its own Thursday Members Draw board, nothing of Tugun's.
select venue_id, slug, jsonb_array_length(slides) as slide_count, updated_at
  from public.vp_venue_screen
 where venue_id = '876b2667-8eec-43ff-b100-58fe3daa8462';

-- Optional tidy: the four files can also go from Storage > venue-ads >
-- 876b2667-8eec-43ff-b100-58fe3daa8462 (1785913469992-ejafbt.png, 1785913476039-yw20ya.png,
-- 1785913480081-glxxnt.png, 1785913495059-qyul1x.png). Nothing reads them once the row is empty.
