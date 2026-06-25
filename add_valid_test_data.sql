-- Get existing users to use as followers
-- Then add test followers and views

-- First, let's use existing users as followers (avoid foreign key issues)
WITH existing_users AS (
  SELECT id FROM "User" WHERE id != 'REPLACE_WITH_ACTUAL_USER_ID' LIMIT 1000
),
follower_data AS (
  SELECT 
    gen_random_uuid() as id,
    eu.id as followerId,
    'REPLACE_WITH_ACTUAL_USER_ID' as followingId,
    'accepted' as status,
    NOW() - (random() * 30 || ' days')::interval as createdAt
  FROM existing_users eu
  CROSS JOIN generate_series(1, CEILING(1000.0 / (SELECT COUNT(*) FROM existing_users))) s
  LIMIT 1000
)
INSERT INTO "Follow" ("id", "followerId", "followingId", "status", "createdAt")
SELECT * FROM follower_data
ON CONFLICT ("followerId", "followingId") DO NOTHING;

-- Add views to your posts (last 30 days)
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  p.id,
  CASE 
    WHEN random() > 0.3 THEN NULL 
    ELSE (SELECT id FROM "User" WHERE id != p."userId" ORDER BY random() LIMIT 1)
  END,
  NOW() - (random() * 30 || ' days')::interval
FROM "Post" p
WHERE p."userId" = 'REPLACE_WITH_ACTUAL_USER_ID'
LIMIT 15000
ON CONFLICT DO NOTHING;

-- Verify the results
SELECT 
  (SELECT COUNT(*) FROM "Follow" WHERE "followingId" = 'REPLACE_WITH_ACTUAL_USER_ID' AND "status" = 'accepted') as followers_count,
  (SELECT COUNT(*) FROM "PostView" pv JOIN "Post" p ON pv."postId" = p.id 
   WHERE p."userId" = 'REPLACE_WITH_ACTUAL_USER_ID' AND pv."createdAt" >= NOW() - INTERVAL '30 days') as views_last_30_days;
