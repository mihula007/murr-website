import { writeFileSync } from 'node:fs'
import { domainToASCII } from 'node:url'

const configuredDomain = process.env.PAGES_CUSTOM_DOMAIN?.trim()
if (configuredDomain) {
  const domain = domainToASCII(configuredDomain)
  if (
    !domain ||
    domain.length > 253 ||
    !domain.includes('.') ||
    !domain
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  ) {
    throw new Error('PAGES_CUSTOM_DOMAIN должен содержать только доменное имя')
  }
  writeFileSync('dist/CNAME', `${domain.toLowerCase()}\n`)
}
