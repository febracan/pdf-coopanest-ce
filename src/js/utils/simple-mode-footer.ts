if (__SIMPLE_MODE__) {
  const hiddenKeyParts = [
    'howItWorks',
    'relatedTools',
    'relatedPdf',
    'faq.section',
  ];
  const hiddenHeadings = [
    'How It Works',
    'Related PDF Tools',
    'Related Tools',
    'Frequently Asked Questions',
    'Como funciona',
    'Ferramentas relacionadas',
    'Perguntas frequentes',
  ];

  for (const section of document.querySelectorAll('section')) {
    const h2 = section.querySelector('h2');
    if (!h2) continue;

    const key = h2.getAttribute('data-i18n') || '';
    const heading = h2.textContent?.trim() || '';

    const shouldHide =
      hiddenKeyParts.some((part) => key.includes(part)) ||
      hiddenHeadings.some((text) => heading.includes(text));

    if (shouldHide) {
      (section as HTMLElement).style.display = 'none';
    }
  }
}
