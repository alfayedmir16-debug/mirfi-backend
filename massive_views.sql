-- Clear existing views first
DELETE FROM "PostView" WHERE "postId" IN (
  SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58'
);

-- Add massive views - 15000 per post to ensure we hit the target
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  p.id,
  CASE 
    WHEN random() > 0.2 THEN NULL 
    ELSE 'viewer_' || generate_series(1, 1000)::text
  END,
  NOW() - (random() * 30 || ' days')::interval
FROM "Post" p
WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58'
CROSS JOIN generate_series(1, 1500) -- 1500 views per post
ON CONFLICT DO NOTHING;

-- Alternative: Add views directly without post dependency
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' ORDER BY random() LIMIT 1),
  CASE WHEN random() > 0.3 THEN NULL ELSE 'viewer_' || generate_series(1, 500)::text END,
  NOW() - (random() * 30 || ' days')::interval
FROM generate_series(1, 15000)
ON CONFLICT DO NOTHING;

-- Verify the results
SELECT 
  'Total Views Last 30 Days' as metric,
  COUNT(*) as count
FROM "PostView" pv 
JOIN "Post" p ON pv."postId" = p.id 
WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' 
AND pv."createdAt" >= NOW() - INTERVAL '30 days';
