const mongoose = require('mongoose');

const playlistItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    videoId: { type: String },
    sourceType: {
      type: String,
      enum: ['youtube', 'vimeo', 'direct', 'local', 'r2'],
      default: 'youtube',
    },
    sourceUrl: { type: String, default: null },
    r2Key: { type: String, default: null },
    playlistId: { type: String, default: null },
    playlistTitle: { type: String, default: null },
    title: { type: String, default: 'Untitled Lecture' },
    author: { type: String, default: '' },
    thumbnail: { type: String, default: null },
    duration: { type: Number, default: 0 },
    lastPosition: { type: Number, default: 0 },
    mimeType: { type: String, default: null },
    sizeBytes: { type: Number, default: null },
    queueOrder: { type: Number, default: 0 },
    lastWatchedAt: { type: String, default: null },
  },
  { _id: false }
);

const playlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  playlistId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    default: 'Study Queue',
  },
  isSharedWithFriends: {
    type: Boolean,
    default: false,
    index: true,
  },
  items: {
    type: [playlistItemSchema],
    default: [],
  },
  createdAt: {
    type: Number,
    default: () => Date.now(),
  },
  updatedAt: {
    type: Number,
    default: () => Date.now(),
  },
});

playlistSchema.index({ userId: 1, playlistId: 1 }, { unique: true });

module.exports = mongoose.model('Playlist', playlistSchema);
