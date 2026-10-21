import { TFile } from 'obsidian';
import { AiChatSuggestModal } from '../src/aichat/AiChatSuggestModal';
import { renderChatAvatar } from '../src/aichat/ChatAvatar';

export async function verifyChatAvatars(assert, settle) {
	const host = document.body.createDiv(); host.style.imageRendering = 'pixelated';
	const waitFor = async condition => { for (let attempt = 0; attempt < 40; attempt++) { if (condition()) return; await settle(); } throw new Error('Portrait rendering did not settle'); };
	const canvas = document.createElement('canvas'); canvas.width = 60; canvas.height = 90;
	const paint = canvas.getContext('2d'); paint.fillStyle = '#b45287'; paint.fillRect(10, 10, 40, 65);
	const character = Object.assign(new TFile(), { path: '인물/테스트.md', basename: '테스트' });
	const photo = Object.assign(new TFile(), { path: '이미지/프로필 사진.png' });
	let resource = canvas.toDataURL('image/png');
	const plugin = { settings: { wikiImageFieldName: '프로필' }, app: {
		metadataCache: { getFileCache: () => ({ frontmatter: { 프로필: '[[프로필 사진.png]]' } }), getFirstLinkpathDest: (path, source) => path === '프로필 사진.png' && source === character.path ? photo : null },
		vault: { getResourcePath: file => { assert(file === photo, 'Portrait resolved a different image'); return resource; } },
	} };
	const picker = new AiChatSuggestModal(plugin, '인물', [character], () => {});
	const renderBoth = () => {
		host.empty(); const message = host.createDiv({ cls: 'wm-chat-message-heading' });
		renderChatAvatar(message, plugin, character);
		picker.renderSuggestion({ item: character }, host.createDiv());
		return [...host.querySelectorAll('canvas')];
	};
	const images = renderBoth();
	assert(images.length === 2 && images.every(image => image.hidden) && !host.querySelector('img'), 'Portrait shows an unprocessed or pending image');
	await waitFor(() => images.every(image => !image.hidden));
	for (const [index, image] of images.entries()) {
		const avatar = image.parentElement, initial = avatar.querySelector('.wm-chat-avatar-initial');
		assert(initial.hidden, 'Loaded transparent portrait still shows its fallback initial');
		const a = avatar.getBoundingClientRect(), b = image.getBoundingClientRect(), size = index ? 30 : 44;
		assert(a.width === size && a.height === size && b.width === size && b.height === size && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1, 'Loaded portrait is distorted or outside its circle');
		assert(image.width >= size * 2 && image.height === image.width && getComputedStyle(image).imageRendering === 'auto', 'Portrait backing pixels or inherited pixelated rendering is incorrect');
		const context = image.getContext('2d'), center = context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data;
		assert(center[0] === 180 && center[1] === 82 && center[2] === 135 && center[3] === 255, 'Centered crop lost the source image content');
		assert(context.getImageData(0, 0, 1, 1).data[3] === 0, 'Transparent source was filled instead of preserved');
	}
	const cached = renderBoth(); await Promise.resolve(); await Promise.resolve();
	assert(cached.every(image => !image.hidden), 'Cached portrait was decoded again on message rerender');
	resource = 'data:image/png;base64,not-a-valid-image'; renderBoth(); await waitFor(() => !host.querySelector('canvas'));
	assert(!host.querySelector('img, canvas') && [...host.querySelectorAll('.wm-chat-avatar-initial')].every(initial => !initial.hidden), 'Failed portrait leaves a broken image in chat or the character picker');
	picker.close(); host.remove();
	console.info('Chat and picker portraits: smoothed high-density PNG crop, pixel content/transparency, inherited pixelated override, cached rerender and failure fallback passed');
}
