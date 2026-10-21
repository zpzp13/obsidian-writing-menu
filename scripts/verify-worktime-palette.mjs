// Real canvas paint and production card selectors, with synthetic data only.
import { WritingTimeChart } from '../src/dashboard/WritingTimeChart';
import { DEFAULT_SETTINGS } from '../src/types';

export async function runWorktimePaletteChecks(assert, settle, revisionHost) {
	const colors=['#fe647d','#ff9f6b','#f2c572','#1ad1a1','#60bcfc','#7b75c9','#d9a8e6'];
	const rgb=hex=>'rgb('+[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16)).join(', ')+')';
	const modes=[...DEFAULT_SETTINGS.timeModes,...['플롯','조사','검토','기타','추가'].map((label,index)=>({id:'extra-'+index,label,frontmatterKey:'extra-'+index,goalSeconds:7200}))];
	const history=Array.from({length:30},(_,day)=>({date:'2026-10-'+String(day+1).padStart(2,'0'),values:Object.fromEntries(modes.map((mode,index)=>[mode.id,Math.round(300+index*90+Math.sin(day*.8+index)*150)]))}));
	const host=document.body.createDiv({cls:'dashboard-preview'});host.style.cssText='display:block;width:900px;max-width:100%;padding:24px;box-sizing:border-box';
	const card=host.createDiv({cls:'wm-wt-card'}),grid=card.createDiv({cls:'wm-wt-mode-grid'});
	// The same mode-card DOM/classes used by WritingTimeSection, including >7 modes.
	for(const [index,mode] of modes.entries()){
		const tile=grid.createDiv({cls:'wm-wt-mode-card'}),chip=tile.createDiv({cls:'wm-wt-mc-chip-wrap'});
		chip.createSpan({cls:'wm-wt-mc-chip-icon',text:'●'});chip.createSpan({cls:'wm-wt-mc-chip-label',text:mode.label});
		tile.createDiv({cls:'wm-wt-mc-progress-track'}).createDiv({cls:'wm-wt-mc-progress-fill'}).style.width='35%';
		const body=tile.createDiv({cls:'wm-wt-mc-body'}),row=body.createDiv({cls:'wm-wt-mc-metric-row'});
		row.createDiv({cls:'wm-wt-mc-time',text:(index+1)*6+'m'});row.createDiv({cls:'wm-wt-mc-percent',text:'35%'});
		body.createDiv({cls:'wm-wt-mc-goal',text:'of 2h'});
		const footer=tile.createDiv({cls:'wm-wt-mc-footer'}),average=footer.createDiv({cls:'wm-wt-mc-average'});
		average.createDiv({cls:'wm-wt-mc-average-value',text:'avg 6m'});average.createDiv({cls:'wm-wt-mc-average-label',text:'last 7 days'});
		const bars=footer.createDiv({cls:'wm-wt-mc-mini-bars'});
		for(const entry of history.slice(-7))bars.createSpan().style.height=(entry.values[mode.id]/1200*100)+'%';
	}
	const chart=new WritingTimeChart(card,modes);chart.setHistory(history,{});await settle();
	const canvas=card.querySelector('canvas'),context=canvas.getContext('2d');
	const verify=async()=>{
		assert(chart.colors().join('/')===colors.join('/'),'Canvas did not resolve the shared seven-color CSS palette');
		const fillRect=context.fillRect,fills=[];
		context.fillRect=function(...args){fills.push(this.fillStyle);return fillRect.apply(this,args);};
		try{chart.setLive({});chart.draw(performance.now());}finally{context.fillRect=fillRect;}
		assert(new Set(fills).size===7&&fills.every(color=>typeof color==='string'&&colors.includes(color)),'Worktime canvas still uses old colors or gradients');
		const bounds=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:bounds.left+150,clientY:bounds.top+70}));await settle();
		assert(card.querySelector('.wm-wt-chart-tooltip.is-visible'),'Daily worktime preview did not open');
		const legend=card.querySelectorAll('.wm-wt-chart-legend .wm-wt-chart-swatch'),tooltip=card.querySelectorAll('.wm-wt-chart-tooltip-row .wm-wt-chart-swatch');
		assert(legend.length===modes.length&&tooltip.length===modes.length,'Worktime legend/tooltip lost a configured mode');
		for(const [index,tile] of [...grid.children].entries()){
			const expected=rgb(colors[index%7]);
			for(const selector of ['.wm-wt-mc-chip-icon','.wm-wt-mc-time','.wm-wt-mc-average-value'])assert(getComputedStyle(tile.querySelector(selector)).color===expected,'Worktime card has a mismatched color: '+index+' '+selector);
			for(const selector of ['.wm-wt-mc-progress-fill','.wm-wt-mc-mini-bars > span']){
				const style=getComputedStyle(tile.querySelector(selector));assert(style.backgroundColor===expected&&style.backgroundImage==='none','Worktime card bar is not flat or has the wrong color');
			}
			assert(getComputedStyle(legend[index]).backgroundColor===expected&&getComputedStyle(tooltip[index]).backgroundColor===expected,'Canvas/card/legend/tooltip color mapping differs: '+index);
		}
		const revision=revisionHost.querySelector('.wm-revision-root');
		const revisionKinds=['dialogue','repeat','special','narration','sentence','paragraph','monologue'];
		for(let index=0;index<7;index++)assert(getComputedStyle(revision).getPropertyValue('--wm-analysis-'+revisionKinds[index]).trim()===colors[index],'Warm-first worktime order changed the Revision colors');
		canvas.dispatchEvent(new PointerEvent('pointerleave'));await settle();
	};
	await verify();document.body.classList.replace('theme-light','theme-dark');await verify();document.body.classList.replace('theme-dark','theme-light');
	host.style.display='none';
	console.info('Warm-first flat palette: real canvas, worktime cards, 8-mode wrapping, legends, tooltips, unchanged Revision colors and light/dark consistency passed');
	return {show(){host.style.display='block';chart.setLive({});},hide(){host.style.display='none';}};
}
