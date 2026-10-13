/**
 * Cover image preprocessing for the pack payload.
 *
 * Quality-first: images already within bgm's ~2.5MB limit are passed through
 * untouched. Oversized ones are re-encoded progressively — at their original
 * resolution with high quality first, then through downscale steps — until
 * they fit. PNG stays PNG (lossless); everything else becomes JPEG (with a
 * white background for transparency), because bgm-style uploaders only take
 * jpg / png / gif.
 */

export const COVER_SIZE_LIMIT = 2.5 * 1024 * 1024;

/** Formats accepted by the uploader as-is, provided the file is small enough. */
const PASSTHROUGH_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);

/**
 * Progressive encode ladder for oversized images. The first round keeps the
 * original resolution (4096 only guards against absurd inputs); `quality` is
 * ignored by PNG, whose ladder relies on the downscale steps and the final
 * JPEG fallback instead.
 */
const ROUNDS: { maxDim: number; quality: number }[] = [
	{ maxDim: 4096, quality: 0.92 },
	{ maxDim: 3000, quality: 0.85 },
	{ maxDim: 2000, quality: 0.75 }
];

export interface ProcessedCover {
	/** data: URL of the final image, ready to ship in the pack payload. */
	dataUrl: string;
	name: string;
	originalSize: number;
	finalSize: number;
	/** Whether the bytes went through the encoder (i.e. differ from the source). */
	compressed: boolean;
}

export function formatBytes(size: number): string {
	if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)}MB`;
	return `${Math.round(size / 1024)}KB`;
}

export async function processCoverImage(file: File): Promise<ProcessedCover> {
	const name = file.name || 'cover';
	const originalSize = file.size;
	const type = detectImageType(file);

	if (type && PASSTHROUGH_TYPES.has(type) && originalSize <= COVER_SIZE_LIMIT) {
		return {
			dataUrl: await blobToDataUrl(file),
			name,
			originalSize,
			finalSize: originalSize,
			compressed: false
		};
	}

	const { img, release } = await loadImage(file);
	try {
		const ladder: { maxDim: number; quality: number; type: string }[] =
			type === 'image/png'
				? [
						...ROUNDS.map((r) => ({ ...r, type: 'image/png' })),
						// PNG cannot trade quality, so if downscaling alone still
						// doesn't fit, fall back to JPEG as a last resort.
						{ maxDim: 2000, quality: 0.85, type: 'image/jpeg' }
					]
				: ROUNDS.map((r) => ({ ...r, type: 'image/jpeg' }));

		let blob: Blob | null = null;
		for (const round of ladder) {
			blob = await encodeImage(img, round.maxDim, round.quality, round.type);
			if (blob.size <= COVER_SIZE_LIMIT) break;
		}
		if (!blob) throw new Error('图片编码失败');

		return {
			dataUrl: await blobToDataUrl(blob),
			name,
			originalSize,
			finalSize: blob.size,
			compressed: true
		};
	} finally {
		release();
	}
}

/** Detect the mime type from `File.type`, falling back to the file extension. */
function detectImageType(file: File): string {
	const mime = (file.type || '').toLowerCase();
	if (mime.startsWith('image/')) return mime;
	const ext = (file.name.split('.').pop() || '').toLowerCase();
	switch (ext) {
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'png':
			return 'image/png';
		case 'gif':
			return 'image/gif';
		case 'webp':
			return 'image/webp';
		case 'avif':
			return 'image/avif';
		case 'bmp':
			return 'image/bmp';
		default:
			return '';
	}
}

function loadImage(file: File): Promise<{ img: HTMLImageElement; release: () => void }> {
	const url = URL.createObjectURL(file);
	const img = new Image();
	return new Promise((resolve, reject) => {
		img.onload = () => {
			if (!img.naturalWidth || !img.naturalHeight) {
				URL.revokeObjectURL(url);
				reject(new Error('无法解析图片尺寸'));
				return;
			}
			resolve({ img, release: () => URL.revokeObjectURL(url) });
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('无法解码该图片，请换一张试试'));
		};
		img.src = url;
	});
}

async function encodeImage(
	img: HTMLImageElement,
	maxDim: number,
	quality: number,
	type: string
): Promise<Blob> {
	let width = img.naturalWidth;
	let height = img.naturalHeight;
	if (Math.max(width, height) > maxDim) {
		const scale = maxDim / Math.max(width, height);
		width = Math.max(1, Math.round(width * scale));
		height = Math.max(1, Math.round(height * scale));
	}

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('无法创建画布');
	if (type === 'image/jpeg') {
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, width, height);
	}
	ctx.drawImage(img, 0, 0, width, height);

	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
	if (!blob) throw new Error('图片编码失败');
	return blob;
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
		reader.readAsDataURL(blob);
	});
}
