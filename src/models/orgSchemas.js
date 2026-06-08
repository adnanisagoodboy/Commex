const mongoose = require('mongoose');

//  Comment Schema 
const commentSchema = new mongoose.Schema({
  pageUrl:      { type: String, required: true, index: true },
  pageTitle:    { type: String, default: '' },
  authorId:     { type: String, required: true, index: true },
  authorName:   { type: String, required: true },
  authorAvatar: { type: String, default: '' },
  authorBadge:  { type: String, default: '' },
  content:      { type: String, required: true, maxlength: 10000 },
  contentType:  { type: String, enum: ['text', 'gif', 'image', 'mixed'], default: 'text' },
  gifUrl:       { type: String, default: null },
  imageUrl:     { type: String, default: null },
  mentions:     [{ type: String }],
  parentId:     { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  rootId:       { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  depth:        { type: Number, default: 0 },
  replyCount:   { type: Number, default: 0 },
  path:         { type: String, default: '' },
  reactionCounts: { type: Map, of: Number, default: {} },
  totalReactions: { type: Number, default: 0 },
  isDeleted:    { type: Boolean, default: false },
  isEdited:     { type: Boolean, default: false },
  editedAt:     { type: Date, default: null },
  // Approval system
  status: { 
    type: String, 
    enum: ['approved', 'pending', 'rejected'], 
    default: 'approved',
    index: true,
  },
  isPinned:     { type: Boolean, default: false },
  isSpam:       { type: Boolean, default: false },
  isFlagged:    { type: Boolean, default: false },
  flagCount:    { type: Number, default: 0 },
  flaggedBy:    [{ type: String }],
  upvotes:      { type: Number, default: 0 },
  downvotes:    { type: Number, default: 0 },
  score:        { type: Number, default: 0 },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

commentSchema.index({ pageUrl: 1, createdAt: -1 });
commentSchema.index({ pageUrl: 1, parentId: 1 });
commentSchema.index({ authorId: 1, createdAt: -1 });
commentSchema.index({ score: -1 });

//  Reaction Schema ─
const reactionSchema = new mongoose.Schema({
  commentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  pageUrl:   { type: String, required: true, index: true },
  userId:    { type: String, required: true },
  type:      { type: String, required: true },
  customEmoji: { type: String, default: null },
}, { timestamps: true });

reactionSchema.index({ commentId: 1, userId: 1 }, { unique: true });
reactionSchema.index({ userId: 1, pageUrl: 1 });

//  Page Reaction Schema 
const pageReactionSchema = new mongoose.Schema({
  pageUrl: { type: String, required: true, index: true },
  userId:  { type: String, required: true },
  type:    { type: String, required: true },
}, { timestamps: true });

pageReactionSchema.index({ pageUrl: 1, userId: 1 }, { unique: true });

//  Notification Schema 
const notificationSchema = new mongoose.Schema({
  userId:       { type: String, required: true, index: true },
  type:         { type: String, enum: ['reply', 'mention', 'reaction', 'pin'], required: true },
  commentId:    { type: mongoose.Schema.Types.ObjectId },
  fromUserId:   { type: String },
  fromUserName: { type: String },
  pageUrl:      { type: String },
  pageTitle:    { type: String },
  preview:      { type: String },
  isRead:       { type: Boolean, default: false },
}, { timestamps: true });

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

//  Factory — safe model registration 
// mongoose throws OverwriteModelError if you call connection.model(name, schema)
// when the model is already registered on that connection.
// We guard with modelNames() to reuse the existing model instead.
function getOrCreateModel(connection, name, schema) {
  if (connection.modelNames().includes(name)) {
    return connection.model(name);
  }
  return connection.model(name, schema);
}

function createOrgModels(connection) {
  return {
    Comment:      getOrCreateModel(connection, 'Comment',      commentSchema),
    Reaction:     getOrCreateModel(connection, 'Reaction',     reactionSchema),
    PageReaction: getOrCreateModel(connection, 'PageReaction', pageReactionSchema),
    Notification: getOrCreateModel(connection, 'Notification', notificationSchema),
  };
}

module.exports = { createOrgModels };
