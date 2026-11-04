/**
 * Positional bit tables from the EDID base block.
 *
 * These are ORDER-CRITICAL. Every entry's index is its bit position, so an
 * insertion anywhere but the end silently rewrites the meaning of an existing
 * EDID. Append only.
 */

/** Established Timings I & II, bytes 35-36, MSB of byte 35 first. */
export const ESTABLISHED_I_II = [
  '720x400 @70',
  '720x400 @88',
  '640x480 @60',
  '640x480 @67',
  '640x480 @72',
  '640x480 @75',
  '800x600 @56',
  '800x600 @60',
  '800x600 @72',
  '800x600 @75',
  '832x624 @75',
  '1024x768 @87i',
  '1024x768 @60',
  '1024x768 @70',
  '1024x768 @75',
  '1280x1024 @75',
] as const

/** Byte 37 bit 7. Bits 6-0 of that byte are manufacturer-reserved. */
export const ESTABLISHED_EXTRA = '1152x870 @75'

/**
 * Established Timings III (descriptor tag 0xF7), bytes 6-17 of the descriptor,
 * MSB first. 44 defined slots; the remainder are reserved and stay zero.
 */
export const ESTABLISHED_III_MODES = [
  '640x350 @85',
  '640x400 @85',
  '720x400 @85',
  '640x480 @85',
  '848x480 @60',
  '800x600 @85',
  '1024x768 @85',
  '1152x864 @75',
  '1280x768 @60 RB',
  '1280x768 @60',
  '1280x768 @75',
  '1280x768 @85',
  '1280x960 @60',
  '1280x960 @85',
  '1280x1024 @60',
  '1280x1024 @85',
  '1360x768 @60',
  '1440x900 @60 RB',
  '1440x900 @60',
  '1440x900 @75',
  '1440x900 @85',
  '1400x1050 @60 RB',
  '1400x1050 @60',
  '1400x1050 @75',
  '1400x1050 @85',
  '1680x1050 @60 RB',
  '1680x1050 @60',
  '1680x1050 @75',
  '1680x1050 @85',
  '1600x1200 @60',
  '1600x1200 @65',
  '1600x1200 @70',
  '1600x1200 @75',
  '1600x1200 @85',
  '1792x1344 @60',
  '1792x1344 @75',
  '1856x1392 @60',
  '1856x1392 @75',
  '1920x1200 @60 RB',
  '1920x1200 @60',
  '1920x1200 @75',
  '1920x1200 @85',
  '1920x1440 @60',
  '1920x1440 @75',
] as const

/** Standard Timing aspect ratio field, bits 7-6 of the second byte. */
export const STD_ASPECTS = ['16:10', '4:3', '5:4', '16:9'] as const

/** Digital interface, low nibble of byte 20 when bit 7 is set. */
export const DIGITAL_INTERFACES = [
  'undefined',
  'dvi',
  'hdmi-a',
  'hdmi-b',
  'mddi',
  'displayport',
] as const

/** Colour bit depth, bits 6-4 of byte 20. Index 7 is reserved. */
export const BIT_DEPTHS = [
  'undefined',
  6,
  8,
  10,
  12,
  14,
  16,
] as const

/**
 * CTA-861 short audio descriptor sample rates, byte 1 bits 6-0, LSB first.
 * Bit 7 is reserved.
 */
export const CTA_AUDIO_RATES = [32, 44.1, 48, 88.2, 96, 176.4, 192] as const

/** CTA-861 audio format codes, index = code. */
export const CTA_AUDIO_FORMATS = [
  'reserved',
  'LPCM',
  'AC-3',
  'MPEG-1',
  'MP3',
  'MPEG-2',
  'AAC LC',
  'DTS',
  'ATRAC',
  'DSD',
  'E-AC-3',
  'DTS-HD',
  'MAT',
  'DST',
  'WMA Pro',
  'extended',
] as const

/** Speaker allocation bits, byte 0 of the SAB, LSB first. */
export const CTA_SPEAKERS = [
  'FL/FR',
  'LFE1',
  'FC',
  'BL/BR',
  'BC',
  'FLc/FRc',
  'RLC/RRC',
  'FLW/FRW',
] as const
