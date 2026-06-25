-- First get your user ID from the previous query result
-- Then replace 'REPLACE_WITH_ACTUAL_USER_ID' with your real user ID

-- Add 1000 followers (avoiding duplicates)
INSERT INTO "Follow" ("id", "followerId", "followingId", "status", "createdAt")
SELECT 
  gen_random_uuid(),
  'follower_' || generate_series(1, 1000)::text,
  'REPLACE_WITH_ACTUAL_USER_ID', -- IMPORTANT: Replace this with your actual user ID
  'accepted',
  NOW() - (random() * 30 || ' days')::interval
ON CONFLICT ("followerId", "followingId") DO NOTHING;

-- Add 15000 views to your posts (last 30 days)
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  p.id,
  CASE WHEN random() > 0.3 THEN NULL ELSE 'viewer_' || generate_series(1, 500)::text END,
  NOW() - (random() * 30 || ' days')::interval
FROM "Post" p
WHERE p."userId" = 'REPLACE_WITH_ACTUAL_USER_ID' -- IMPORTANT: Replace this too
LIMIT 15000
ON CONFLICT DO NOTHING;

-- Verify the results
SELECT 
  (SELECT COUNT(*) FROM "Follow" WHERE "followingId" = 'REPLACE_WITH_ACTUAL_USER_ID' AND "status" = 'accepted') as followers_count,
  (SELECT COUNT(*) FROM "PostView" pv JOIN "Post" p ON pv."postId" = p.id 
   WHERE p."userId" = 'REPLACE_WITH_ACTUAL_USER_ID' AND pv."createdAt" >= NOW() - INTERVAL '30 days') as views_last_30_days;
