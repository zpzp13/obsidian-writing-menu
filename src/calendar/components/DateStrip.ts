import { formatDateKey } from '../../utils/dateUtils';

const DOW_KO = ['일','월','화','수','목','금','토'];

const CARD_W = 36;
const GAP    = 10;
const SLOT   = CARD_W + GAP;

type DateStripCallbacks = {
	onDateChange:  (date: Date) => void;
	onMonthChange: (month: number) => void;
	openDailyNote: (date: Date) => void;
	onHover?:      (date: Date, el: HTMLElement) => void;
	onHoverEnd?:   () => void;
};

export class DateStrip {
	readonly el: HTMLElement;
	private stripEl: HTMLElement;
	private allCards: HTMLElement[] = [];
	private activeCard: HTMLElement | null = null;
	private programmaticScrollUntil = 0;

	constructor(
		container: HTMLElement,
		year: number,
		selectedDate: Date,
		callbacks: DateStripCallbacks,
	) {
		const wrap  = container.createDiv({ cls: 'wm-cal-date-strip-wrap' });
		const strip = wrap.createDiv({ cls: 'wm-cal-date-strip' });
		this.el      = wrap;
		this.stripEl = strip;

		const today    = new Date();
		today.setHours(0, 0, 0, 0);
		const todayStr = today.toDateString();
		const total    = Math.round((new Date(year, 11, 31).getTime() - new Date(year, 0, 1).getTime()) / 86400000) + 1;

		for (let i = 0; i < total; i++) {
			const d  = new Date(year, 0, 1 + i);
			const ds = d.toDateString();
			const isWeekend = d.getDay() === 0 || d.getDay() === 6;
			const card = strip.createDiv({ cls: 'wm-cal-date-card' });
			if (ds === todayStr)                                               card.addClass('wm-cal-dc-today');
			if (ds === selectedDate.toDateString() && ds !== todayStr)         card.addClass('wm-cal-dc-selected');
			if (isWeekend)                                                     card.addClass('wm-cal-dc-weekend');
			card.createDiv({ cls: 'wm-cal-dc-dow', text: DOW_KO[d.getDay()] });
			card.createDiv({ cls: 'wm-cal-dc-num', text: String(d.getDate()) });
			card.dataset.month   = String(d.getMonth());
			card.dataset.ds      = ds;
			card.dataset.datekey = formatDateKey(d);
			if (callbacks.onHover) {
				card.addEventListener('mouseenter', () => callbacks.onHover!(new Date(card.dataset.ds!), card));
				card.addEventListener('mouseleave', () => callbacks.onHoverEnd?.());
			}
			this.allCards.push(card);
		}

		let lastMon    = selectedDate.getMonth();
		this.activeCard = this.allCards.find(c => c.dataset.ds === selectedDate.toDateString()) ?? null;

		const setActiveMon = (mon: number) => {
			if (mon === lastMon) return;
			lastMon = mon;
			this.allCards.forEach(c => c.classList.toggle('wm-cal-dc-dim', parseInt(c.dataset.month ?? '0') !== mon));
			callbacks.onMonthChange(mon);
		};

		const selectCard = (card: HTMLElement) => {
			if (card === this.activeCard) return;
			if (this.activeCard?.dataset.ds !== todayStr) this.activeCard?.classList.remove('wm-cal-dc-selected');
			if (card.dataset.ds !== todayStr)             card.classList.add('wm-cal-dc-selected');
			this.activeCard = card;
			const d = new Date(card.dataset.ds!);
			const newDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
			callbacks.onDateChange(newDate);
		};

		const snapToCard = (card: HTMLElement, smooth = true) => {
			const cr = card.getBoundingClientRect();
			const sr = strip.getBoundingClientRect();
			const relLeft = strip.scrollLeft + (cr.left - sr.left);
			strip.scrollTo({ left: Math.max(0, relLeft - strip.clientWidth / 2 + CARD_W / 2), behavior: smooth ? 'smooth' : 'auto' });
		};

		const centerCard = (): HTMLElement | null => {
			const centerPos = strip.scrollLeft + strip.clientWidth / 2;
			const idx = Math.max(0, Math.min(Math.round((centerPos - CARD_W / 2) / SLOT), this.allCards.length - 1));
			return this.allCards[idx] ?? null;
		};

		// Initial dim + scroll
		this.allCards.forEach(c => c.classList.toggle('wm-cal-dc-dim', parseInt(c.dataset.month ?? '0') !== lastMon));
		let syncEnabled = false;
		window.requestAnimationFrame(() => {
			if (this.activeCard) snapToCard(this.activeCard, false);
			window.requestAnimationFrame(() => { syncEnabled = true; });
		});

		strip.addEventListener('scroll', () => {
			if (!syncEnabled || Date.now() < this.programmaticScrollUntil) return;
			const c = centerCard();
			if (!c) return;
			selectCard(c);
			setActiveMon(parseInt(c.dataset.month ?? '0'));
		}, { passive: true });

		const stripDoc = strip.ownerDocument;
		strip.addEventListener('mousedown', e => {
			e.preventDefault();
			const startX = e.pageX, startScrollLeft = strip.scrollLeft;
			let isDragging = false, hasMoved = false;

			const onMove = (me: MouseEvent) => {
				const dx = me.pageX - startX;
				if (!isDragging && Math.abs(dx) > 4) { isDragging = true; strip.addClass('is-grabbing'); }
				if (isDragging) { strip.scrollLeft = startScrollLeft - dx; hasMoved = true; }
			};
			const onUp = (ue: MouseEvent) => {
				strip.removeClass('is-grabbing');
				stripDoc.removeEventListener('mousemove', onMove);
				stripDoc.removeEventListener('mouseup',  onUp);
				if (!hasMoved) {
					const t    = stripDoc.elementFromPoint(ue.clientX, ue.clientY) as HTMLElement | null;
					const card = t?.closest('.wm-cal-date-card') as HTMLElement | null;
					if (card && this.allCards.includes(card)) {
						if (ue.ctrlKey || ue.metaKey) {
							callbacks.openDailyNote(new Date(card.dataset.ds!));
						} else {
							selectCard(card);
							this.programmaticScrollUntil = Date.now() + 600;
							snapToCard(card);
							setActiveMon(parseInt(card.dataset.month ?? '0'));
						}
					}
				} else {
					const c = centerCard();
					if (c) snapToCard(c);
				}
			};
			stripDoc.addEventListener('mousemove', onMove);
			stripDoc.addEventListener('mouseup',  onUp);
		});
	}

	goTo(date: Date, select = false): void {
		const strip = this.stripEl;
		const card  = this.allCards.find(c => c.dataset.ds === date.toDateString());
		if (!card) return;
		if (select) {
			const todayStr = new Date().toDateString();
			if (this.activeCard?.dataset.ds !== todayStr) this.activeCard?.classList.remove('wm-cal-dc-selected');
			if (card.dataset.ds !== todayStr)             card.classList.add('wm-cal-dc-selected');
			this.activeCard = card;
			this.programmaticScrollUntil = Date.now() + 600;
			const cr = card.getBoundingClientRect();
			const sr = strip.getBoundingClientRect();
			const relLeft = strip.scrollLeft + (cr.left - sr.left);
			strip.scrollTo({ left: Math.max(0, relLeft - strip.clientWidth / 2 + CARD_W / 2), behavior: 'smooth' });
		} else {
			const cr = card.getBoundingClientRect();
			const sr = strip.getBoundingClientRect();
			const relLeft = strip.scrollLeft + (cr.left - sr.left);
			strip.scrollTo({ left: Math.max(0, relLeft - strip.clientWidth / 2 + CARD_W / 2), behavior: 'auto' });
		}
	}
}
