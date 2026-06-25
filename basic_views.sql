-- Clear existing views
DELETE FROM "PostView" WHERE "postId" IN (
  SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58'
);

-- Get the first post ID
-- Add 15000 views with different user IDs
INSERT INTO "PostView" ("id", "postId", "userId", "createdAt")
VALUES 
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), NULL, NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_1', NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_2', NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_3', NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_4', NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_5', NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_6', NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_7', NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_8', NOW() - (random() * 30 || ' days')::interval),
(gen_random_uuid(), (SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58' LIMIT 1), 'viewer_9', NOW() - (random() * 30 || ' days')::interval);

-- Check current count
SELECT COUNT(*) as current_views FROM "PostView" WHERE "postId" IN (
  SELECT id FROM "Post" WHERE "userId" = '6cb3d3ac-1295-42f1-b2d9-f6cd99609b58'
);
