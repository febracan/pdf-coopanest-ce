import { categories } from './config/tools.js';
import {
  categoryTranslationKeys,
  toolTranslationKeys,
} from './config/tool-i18n.js';
import { initI18n, t } from './i18n/index.js';
import { loadRuntimeConfig, isToolDisabled } from './utils/disabled-tools.js';
import { createIcons, icons } from 'lucide';
import '@phosphor-icons/web/regular';
import '../css/styles.css';

const ALL = '__all__';

const categoryIcons: Record<string, string> = {
  __all__: 'ph-squares-four',
  'Popular Tools': 'ph-star',
  'Edit & Annotate': 'ph-pencil-simple',
  'Convert to PDF': 'ph-tray-arrow-down',
  'Convert from PDF': 'ph-export',
  'Organize & Manage': 'ph-stack',
  'Optimize & Repair': 'ph-wrench',
  'Secure PDF': 'ph-lock-simple',
};

interface RenderTool {
  href: string;
  icon: string;
  name: string;
  subtitle: string;
  category: string;
  search: string;
}

const label = (name: string): string => {
  const key = categoryTranslationKeys[name];
  return key ? t(key) : name;
};

const toolText = (name: string, subtitle: string): [string, string] => {
  const key = toolTranslationKeys[name];
  const translatedName = key ? t(`${key}.name`) : name;
  const translatedSubtitle = key ? t(`${key}.subtitle`) : subtitle;
  return [translatedName, translatedSubtitle];
};

const render = (): void => {
  const nav = document.getElementById('hp-nav');
  const grid = document.getElementById('hp-grid');
  const search = document.getElementById(
    'hp-search'
  ) as HTMLInputElement | null;
  const empty = document.getElementById('hp-empty');
  const title = document.getElementById('hp-title');
  if (!nav || !grid || !search) return;

  const cats = categories
    .map((category) => ({
      name: category.name,
      tools: category.tools.filter((tool) => !isToolDisabled(tool.id)),
    }))
    .filter((category) => category.tools.length > 0);

  const allTools: RenderTool[] = [];
  for (const category of cats) {
    for (const tool of category.tools) {
      const [name, subtitle] = toolText(tool.name, tool.subtitle || '');
      allTools.push({
        href: tool.href,
        icon: tool.icon,
        name,
        subtitle,
        category: category.name,
        search: `${name} ${subtitle}`.toLowerCase(),
      });
    }
  }

  const makeNavItem = (
    key: string,
    text: string,
    count: number
  ): HTMLElement => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'hp-nav-item';
    item.dataset.cat = key;
    const iconClass =
      key === ALL ? categoryIcons[ALL] : categoryIcons[key] || 'ph-folder';
    item.innerHTML =
      `<i class="ph ${iconClass}"></i><span class="hp-nav-label"></span>` +
      `<span class="hp-nav-count">${count}</span>`;
    item.querySelector('.hp-nav-label')!.textContent = text;
    return item;
  };

  nav.textContent = '';
  nav.appendChild(makeNavItem(ALL, 'Todas as ferramentas', allTools.length));
  for (const category of cats) {
    nav.appendChild(
      makeNavItem(category.name, label(category.name), category.tools.length)
    );
  }

  grid.textContent = '';
  for (const tool of allTools) {
    const card = document.createElement('a');
    card.href = tool.href;
    card.className = 'hp-card';
    card.dataset.cat = tool.category;
    card.dataset.search = tool.search;

    const icon = document.createElement('i');
    if (tool.icon.startsWith('ph-')) {
      icon.className = `ph ${tool.icon} hp-card-icon`;
    } else {
      icon.setAttribute('data-lucide', tool.icon);
      icon.className = 'hp-card-icon';
    }

    const heading = document.createElement('h3');
    heading.className = 'hp-card-name';
    heading.textContent = tool.name;

    const subtitle = document.createElement('p');
    subtitle.className = 'hp-card-sub';
    subtitle.textContent = tool.subtitle;

    card.append(icon, heading, subtitle);
    grid.appendChild(card);
  }

  createIcons({ icons });

  let activeCat = ALL;

  const apply = (): void => {
    const term = search.value.toLowerCase().trim();
    let visible = 0;
    grid.querySelectorAll<HTMLElement>('.hp-card').forEach((card) => {
      const matchesCat = activeCat === ALL || card.dataset.cat === activeCat;
      const matchesTerm = !term || (card.dataset.search || '').includes(term);
      const show = matchesCat && matchesTerm;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    if (empty) empty.hidden = visible > 0;
    if (title) {
      title.textContent = term
        ? `Resultados para “${search.value.trim()}”`
        : activeCat === ALL
          ? 'Ferramentas de PDF'
          : label(activeCat);
    }
  };

  nav.querySelectorAll<HTMLElement>('.hp-nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      activeCat = item.dataset.cat || ALL;
      nav
        .querySelectorAll('.hp-nav-item')
        .forEach((navItem) =>
          navItem.classList.toggle('is-active', navItem === item)
        );
      if (search.value) search.value = '';
      apply();
      document
        .querySelector('.hp-main')
        ?.scrollTo({ top: 0, behavior: 'smooth' });
      document.getElementById('hp-sidebar')?.classList.remove('is-open');
    });
  });
  nav.querySelector('.hp-nav-item')?.classList.add('is-active');

  search.addEventListener('input', apply);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      search.focus();
    }
  });

  const sidebar = document.getElementById('hp-sidebar');
  document.getElementById('hp-menu-btn')?.addEventListener('click', () => {
    sidebar?.classList.toggle('is-open');
  });
  document.getElementById('hp-scrim')?.addEventListener('click', () => {
    sidebar?.classList.remove('is-open');
  });

  apply();
};

const boot = async (): Promise<void> => {
  await initI18n();
  await loadRuntimeConfig();
  render();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
