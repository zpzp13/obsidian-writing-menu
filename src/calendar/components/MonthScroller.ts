const MONTH_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

export class MonthScroller {
	readonly el: HTMLElement;
	private pills: HTMLElement[] = [];
	private monthScrollUntil = 0;
	private navTimer = 0;

	constructor(
		container: HTMLElement,
		currMon: number,
		year: number,
		onSelect: (month: number) => void,
		isFullMode: boolean,
	) {
		const scroller = container.createDiv({ cls: 'wm-cal-month-scroll' });
		this.el = scroller;

		for (let m = 0; m < 12; m++) {
			const pill = scroller.createSpan({
				cls: m === currMon ? 'wm-cal-ms-month wm-cal-ms-curr' : 'wm-cal-ms-month',
				text: MONTH_KO[m],
			});
			pill.dataset.mon = String(m);
			this.pills.push(pill);
		}

		const centerPill = (): HTMLElement | null => {
			const sr = scroller.getBoundingClientRect();
			const cp = sr.left + sr.width / 2;
			let nearest: HTMLElement | null = null;
			let minDist = Infinity;
			for (const p of this.pills) {
				const pr  = p.getBoundingClientRect();
				const dist = Math.abs(pr.left + pr.width / 2 - cp);
				if (dist < minDist) { minDist = dist; nearest = p; }
			}
			return nearest;
		};

		const snapToPill = (pill: HTMLElement, smooth = true) => {
			const cr = pill.getBoundingClientRect();
			const sr = scroller.getBoundingClientRect();
			const relLeft = scroller.scrollLeft + (cr.left - sr.left);
			const target  = relLeft - scroller.clientWidth / 2 + cr.width / 2;
			this.monthScrollUntil = Date.now() + 600;
			scroller.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
		};

		const selectPill = (pill: HTMLElement) => {
			this.pills.forEach(p => p.classList.toggle('wm-cal-ms-curr', p === pill));
			onSelect(parseInt(pill.dataset.mon ?? '0'));
		};

		requestAnimationFrame(() => snapToPill(this.pills[currMon], false));

		let syncEnabled = false;
		requestAnimationFrame(() => requestAnimationFrame(() => { syncEnabled = true; }));

		scroller.addEventListener('scroll', () => {
			if (!syncEnabled || Date.now() < this.monthScrollUntil) return;
			const p = centerPill();
			if (!p) return;
			this.pills.forEach(pp => pp.classList.toggle('wm-cal-ms-curr', pp === p));
			if (isFullMode) {
				clearTimeout(this.navTimer);
				const mon = parseInt(p.dataset.mon ?? '0');
				this.navTimer = window.setTimeout(() => onSelect(mon), 220);
			}
		}, { passive: true });

		scroller.addEventListener('mousedown', e => {
			e.preventDefault();
			const startX = e.pageX, startL = scroller.scrollLeft;
			let isDragging = false, hasMoved = false;

			const onMove = (me: MouseEvent) => {
				const dx = me.pageX - startX;
				if (!isDragging && Math.abs(dx) > 4) { isDragging = true; scroller.style.cursor = 'grabbing'; }
				if (isDragging) { scroller.scrollLeft = startL - dx; hasMoved = true; }
			};
			const onUp = (ue: MouseEvent) => {
				scroller.style.cursor = '';
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				if (!hasMoved) {
					const t    = document.elementFromPoint(ue.clientX, ue.clientY) as HTMLElement | null;
					const pill = t?.closest('.wm-cal-ms-month') as HTMLElement | null;
					if (pill && this.pills.includes(pill)) { selectPill(pill); snapToPill(pill); }
				} else {
					const p = centerPill();
					if (p) { selectPill(p); snapToPill(p); }
				}
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	sync(month: number): void {
		const scroller = this.el;
		this.pills.forEach((p, i) => p.classList.toggle('wm-cal-ms-curr', i === month));
		const curr = this.pills[month];
		if (!curr) return;
		const cr = curr.getBoundingClientRect();
		const sr = scroller.getBoundingClientRect();
		const relLeft = scroller.scrollLeft + (cr.left - sr.left);
		const target  = relLeft - scroller.clientWidth / 2 + cr.width / 2;
		this.monthScrollUntil = Date.now() + 600;
		scroller.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
	}
}
