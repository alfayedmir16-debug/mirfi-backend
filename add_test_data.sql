-- Replace YOUR_USER_ID with your actual user ID from the list above
-- Example: 'abc123' or 'user-id-from-database'

-- Add 1000 followers (avoiding duplicates)
INSERT INTO "Follow" ("followerId", "followingId", "status", "createdAt")
SELECT 
  'follower_' || generate_series(1, 1000)::text,
  'YOUR_USER_ID', -- REPLACE THIS
  'accepted',
  NOW() - (random() * 30 || ' days')::interval
ON CONFLICT DO NOTHING;

-- Add 15000 views to your posts (last 30 days)
INSERT INTO "PostView" ("postId", "userId", "createdAt")
SELECT 
  p.id,
  CASE WHEN random() > 0.3 THEN NULL ELSE 'viewer_' || generate_series(1, 500)::text END,
  NOW() - (random() * 30 || ' days')::interval
FROM "Post" p
WHERE p."userId" = 'YOUR_USER_ID' -- REPLACE THIS
LIMIT 15000
ON CONFLICT DO NOTHING;

-- Verify the results
SELECT 
  (SELECT COUNT(*) FROM "Follow" WHERE "followingId" = 'YOUR_USER_ID' AND "status" = 'accepted') as followers_count,
  (SELECT COUNT(*) FROM "PostView" pv JOIN "Post" p ON pv."postId" = p.id 
   WHERE p."userId" = 'YOUR_USER_ID' AND pv."createdAt" >= NOW() - INTERVAL '30 days') as views_last_30_days;
