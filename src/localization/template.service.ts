import { DynamicConfigService } from '../config/dynamic-config.service';

export class TemplateService {
  private configService = DynamicConfigService.getInstance();

  /**
   * Renders a localized template with dynamic parameters
   */
  public render(
    templateKey: string,
    lang: 'am' | 'or' | 'en' = 'am',
    variables: Record<string, string | number> = {}
  ): string {
    const policy = this.configService.getPolicy();
    const templateGroup = policy.localization.templates[templateKey];

    if (!templateGroup) {
      return `[Template not found: ${templateKey}]`;
    }

    let rawText = templateGroup[lang] || templateGroup['am'] || templateGroup['en'] || '';

    // Interpolate placeholders: {{variable_name}}
    for (const [key, val] of Object.entries(variables)) {
      const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      rawText = rawText.replace(pattern, String(val));
    }

    return rawText;
  }
}
