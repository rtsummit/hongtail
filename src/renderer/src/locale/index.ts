// react-i18next 초기화 + lang 결정 helper. ko/en 두 dict 만 등록하고
// AppSettings.language ('auto' | 'ko' | 'en') 에 따라 i18n.changeLanguage
// 호출. 'auto' 면 navigator.language 를 보고 결정.
//
// keySeparator 는 false — dotted key 를 nested 로 분해 안 하고 flat lookup.
// dict 가 단순 Record<string, string> 이라 가독성 / grep 편함.
//
// 인프라는 main.tsx 가 import 해서 init. 컴포넌트는 useTranslation() 로 t() 사용.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ko } from './ko'
import { en } from './en'

export type Lang = 'ko' | 'en'
export type LangSetting = Lang | 'auto'

export const SUPPORTED_LANGS: readonly Lang[] = ['ko', 'en'] as const

export function detectBrowserLang(): Lang {
  if (typeof navigator === 'undefined') return 'ko'
  const raw = (navigator.language || (navigator.languages?.[0] ?? '')).toLowerCase()
  if (raw.startsWith('en')) return 'en'
  // 한국어 + 미지원 모두 ko fallback (한국어 사용자가 1차 타깃)
  return 'ko'
}

export function resolveLang(setting: LangSetting): Lang {
  if (setting === 'auto') return detectBrowserLang()
  return setting
}

void i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en }
  },
  lng: detectBrowserLang(), // 초기는 자동 감지. AppSettings 로드 후 LanguageSync 가 덮어씀.
  fallbackLng: 'ko',
  interpolation: {
    escapeValue: false,
    // 기본 i18next 는 {{key}} 인데 우리 dict 는 단일 {key} 사용. 가독성 + grep 편함.
    prefix: '{',
    suffix: '}'
  },
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false
})

export { i18n }
