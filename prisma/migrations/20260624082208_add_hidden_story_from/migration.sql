/*
  Warnings:

  - You are about to drop the column `mediaUrls` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `qualityFlags` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `qualityScore` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `completed` on the `PostView` table. All the data in the column will be lost.
  - You are about to drop the column `watchDuration` on the `PostView` table. All the data in the column will be lost.
  - You are about to drop the column `creatorCategory` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `isCreator` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `CommentLike` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StoryHighlight` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StoryHighlightItem` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CommentLike" DROP CONSTRAINT "CommentLike_commentId_fkey";

-- DropForeignKey
ALTER TABLE "CommentLike" DROP CONSTRAINT "CommentLike_userId_fkey";

-- DropForeignKey
ALTER TABLE "StoryHighlight" DROP CONSTRAINT "StoryHighlight_userId_fkey";

-- DropForeignKey
ALTER TABLE "StoryHighlightItem" DROP CONSTRAINT "StoryHighlightItem_highlightId_fkey";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "mediaUrls",
DROP COLUMN "qualityFlags",
DROP COLUMN "qualityScore";

-- AlterTable
ALTER TABLE "PostView" DROP COLUMN "completed",
DROP COLUMN "watchDuration";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "creatorCategory",
DROP COLUMN "isCreator",
ADD COLUMN     "hiddenStoryFrom" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- DropTable
DROP TABLE "CommentLike";

-- DropTable
DROP TABLE "StoryHighlight";

-- DropTable
DROP TABLE "StoryHighlightItem";
