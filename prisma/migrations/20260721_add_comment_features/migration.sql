-- Add new columns to Comment table
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;

-- Add self-reference foreign key for nested replies
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create CommentLike table
CREATE TABLE IF NOT EXISTS "CommentLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentLike_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint for one like per user per comment
CREATE UNIQUE INDEX IF NOT EXISTS "CommentLike_userId_commentId_key" ON "CommentLike"("userId", "commentId");

-- Add foreign keys
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS "Comment_parentId_idx" ON "Comment"("parentId");
CREATE INDEX IF NOT EXISTS "Comment_postId_isPinned_idx" ON "Comment"("postId", "isPinned");
CREATE INDEX IF NOT EXISTS "CommentLike_commentId_idx" ON "CommentLike"("commentId");
