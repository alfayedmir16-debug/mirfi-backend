-- Add 5000 more views in batches
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
SELECT 
  gen_random_uuid(),
  (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1),
  'batch_viewer_' || generate_series(1, 5000)::text,
  NOW() - (random() * 30 || ' days')::interval
FROM generate_series(1, 5000)
ON CONFLICT DO NOTHING;

-- Check total count
SELECT 
  COUNT(*) as total_views_last_30_days
FROM "PostView" pv 
JOIN "Post" p ON pv."postId" = p.id 
WHERE p."userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' 
AND pv."createdAt" >= NOW() - INTERVAL '30 days';
