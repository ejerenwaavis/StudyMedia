const mongoose = require('mongoose');

const studyItemSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: String,
      required: true,
      default: 'default',
      index: true,
    },
    videoId: {
      type: String,
      required: true,
    },
    sourceType: {
      type: String,
      enum: ['youtube', 'vimeo', 'direct', 'local'],
      default: 'youtube',
    },
    sourceUrl: {
      type: String,
      default: null,
    },
    playlistId: {
      type: String,
      default: null,
    },
    playlistTitle: {
      type: String,
      default: null,
    },
    title: {
      type: String,
      default: 'Untitled Lecture',
    },
    author: {
      type: String,
      default: '',
    },
    thumbnail: {
      type: String,
      default: '',
    },
    duration: {
      type: Number,
      default: 0,
    },
    lastPosition: {
      type: Number,
      default: 0,
    },
    inQueue: {
      type: Boolean,
      default: true,
    },
    queueOrder: {
      type: Number,
      default: 0,
    },
    lastWatchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

studyItemSchema.index({ workspaceId: 1, videoId: 1 }, { unique: true });

module.exports = mongoose.model('StudyItem', studyItemSchema);
