-- Get your user ID first
SELECT id, username FROM "User" WHERE email = 'your-email@example.com' LIMIT 1;

-- Replace YOUR_USER_ID with the actual ID from above query

-- Add 1000 followers
INSERT INTO "Follow" ("followerId", "followingId", "status", "createdAt")
SELECT 
  generate_series(1, 1000)::text, -- Random follower IDs
  'YOUR_USER_ID', -- Replace with your actual user ID
  'accepted',
  NOW() - (random() * 30 || ' days')::interval
WHERE NOT EXISTS (
  SELECT 1 FROM "Follow" 
  WHERE "followerId" = generate_series(1, 1000)::text 
  AND "followingId" = 'YOUR_USER_ID'
);

-- Get your posts for adding views
SELECT id, "viewCount" FROM "Post" WHERE "userId" = 'YOUR_USER_ID' LIMIT 5;

-- Add 15000 views across your posts (last 30 days)
INSERT INTO "PostView" ("postId", "userId", "createdAt")
SELECT 
  p.id, -- Your post IDs
  CASE WHEN random() > 0.5 THEN NULL ELSE generate_series(1, 100)::text END, -- Some anonymous, some user views
  NOW() - (random() * 30 || ' days')::interval -- Random dates within last 30 days
FROM "Post" p
WHERE p."userId" = 'YOUR_USER_ID'
AND EXISTS (SELECT 1 FROM "PostView" WHERE "postId" = p.id HAVING COUNT(*) < 3000) -- Limit per post
LIMIT 15000;

-- Verify counts
SELECT 
  COUNT(*) as followers_count 
FROM "Follow" 
WHERE "followingId" = 'YOUR_USER_ID' AND "status" = 'accepted';

SELECT 
  COUNT(*) as views_last_30_days 
FROM "PostView" pv
JOIN "Post" p ON pv."postId" = p.id
WHERE p."userId" = 'YOUR_USER_ID' 
AND pv."createdAt" >= NOW() - INTERVAL '30 days';
