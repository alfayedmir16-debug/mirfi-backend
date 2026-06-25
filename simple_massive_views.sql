-- Clear existing views first
DELETE FROM "PostView" WHERE "postId" IN (
  SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58'
);

-- Get one post ID to add all views to
-- Add 15000 views to a single post
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1),
  CASE WHEN random() > 0.3 THEN NULL ELSE 'viewer_' || generate_series(1, 500)::text END,
  NOW() - (random() * 30 || ' days')::interval
FROM generate_series(1, 15000)
ON CONFLICT DO NOTHING;

-- Verify the results
SELECT 
  COUNT(*) as total_views_last_30_days
FROM "PostView" pv 
JOIN "Post" p ON pv."postId" = p.id 
WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' 
AND pv."createdAt" >= NOW() - INTERVAL '30 days';
