import { Request, Response } from 'express';

// Simple link metadata scraper using fetch + regex for OpenGraph tags
export const getLinkPreview = async (req: any, res: any) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url query param required' });
    }

    // Security: only allow http(s) URLs
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid URL scheme' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MirFiBot/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const html = await response.text();

    const getMeta = (prop: string) => {
      const regex = new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
        'i'
      );
      const match = html.match(regex);
      return match ? match[1] : '';
    };

    const title = getMeta('og:title') || getMeta('twitter:title') || html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || url;
    const description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description') || '';
    const image = getMeta('og:image') || getMeta('twitter:image') || '';
    const siteName = getMeta('og:site_name') || new URL(url).hostname.replace(/^www\./, '');

    res.json({ title, description, image, url, siteName });
  } catch (e: any) {
    console.error('Link preview error:', e.message);
    res.status(500).json({ error: 'Failed to fetch preview' });
  }
};
