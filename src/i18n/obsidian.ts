import { getLanguage, moment, requireApiVersion } from 'obsidian';
import { setLanguage } from './index';

// Loaded before UI modules so translated constant tables use the app language too.
// getLanguage was introduced in 1.8.7; Moment supplies the locale on older hosts.
if (requireApiVersion('1.8.7')) {
	setLanguage(getLanguage());
} else if (typeof moment !== 'undefined') {
	setLanguage(moment.locale());
}
