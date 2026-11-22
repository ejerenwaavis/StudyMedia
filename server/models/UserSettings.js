const mongoose = require('mongoose');

const userSettingsSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
    },
    seekInterval: {
      type: Number,
      default: 15,
      min: 1,
      max: 600,
    },
    playbackSpeed: {
      type: Number,
      default: 1.25,
    },
    doubleTapToSkip: {
      type: Boolean,
      default: true,
    },
    doubleTapWindow: {
      type: Number,
      default: 450,
      min: 200,
      max: 1200,
    },
    audioOnlyMode: {
      type: Boolean,
      default: false,
    },
    wakeLockPreferred: {
      type: Boolean,
      default: true,
    },
    activeMode: {
      type: String,
      enum: ['study', 'car', 'theater'],
      default: 'study',
    },
    activeVideoId: {
      type: String,
      default: null,
    },
    sidecarUrl: {
      type: String,
      default: '',
    },
    sidecarApiKey: {
      type: String,
      default: '',
    },
    fallbackConverterUrl: {
      type: String,
      default: 'https://ytmp3.gl/',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserSettings', userSettingsSchema);
