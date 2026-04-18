import axios from 'axios';
import * as cheerio from 'cheerio';
import { instance as searchEngine, Document } from './search-engine.ts';
import { URL } from 'url';

export interface CrawlStats {
  visited: number;
  queued: number;
  errors: number;
  isCrawling: boolean;
}

class Crawler {
  private visitedUrls: Set<string> = new Set();
  private queue: string[] = [];
  private stats: CrawlStats = {
    visited: 0,
    queued: 0,
    errors: 0,
    isCrawling: false
  };

  constructor() {}

  public getStats() {
    return { ...this.stats, queued: this.queue.length };
  }

  public async startCrawl(seedUrl: string, maxPages: number = 50) {
    if (this.stats.isCrawling) return;
    
    this.stats.isCrawling = true;
    this.queue = [seedUrl];
    
    while (this.queue.length > 0 && this.stats.visited < maxPages) {
      const url = this.queue.shift()!;
      if (this.visitedUrls.has(url)) continue;

      try {
        await this.crawlPage(url);
        this.stats.visited++;
        // Small delay to be polite
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error crawling ${url}:`, error);
        this.stats.errors++;
      }
    }

    this.stats.isCrawling = false;
  }

  private async crawlPage(url: string) {
    this.visitedUrls.add(url);
    
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'NexusSearchBot/1.0 (+http://nexussearch.example.com)'
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Metadata extraction
    const title = $('title').text() || url;
    const description = $('meta[name="description"]').attr('content') || '';
    const keywords = $('meta[name="keywords"]').attr('content')?.split(',').map(k => k.trim()) || [];
    
    // Content extraction (sanitized)
    $('script, style, nav, footer').remove();
    const content = $('body').text().replace(/\s+/g, ' ').trim();

    const doc: Document = {
      id: Buffer.from(url).toString('base64'),
      url: url,
      title: title,
      description: description,
      content: content,
      keywords: keywords,
      lastCrawled: Date.now()
    };

    searchEngine.addDocument(doc);

    // Link extraction (BFS)
    const links = $('a');
    links.each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        try {
          const absoluteUrl = new URL(href, url).toString();
          const cleanUrl = absoluteUrl.split('#')[0]; // Remove hash
          
          if (this.isValidUrl(cleanUrl, url) && !this.visitedUrls.has(cleanUrl)) {
            this.queue.push(cleanUrl);
          }
        } catch (e) {
          // Invalid URL, skip
        }
      }
    });
  }

  private isValidUrl(targetUrl: string, baseUrl: string): boolean {
    try {
      const target = new URL(targetUrl);
      const base = new URL(baseUrl);
      
      // Stay on same domain for MVP safety
      const isSameDomain = target.hostname === base.hostname;
      const isHttp = target.protocol === 'http:' || target.protocol === 'https:';
      
      return isSameDomain && isHttp;
    } catch {
      return false;
    }
  }

  public reset() {
    this.visitedUrls.clear();
    this.queue = [];
    this.stats = {
      visited: 0,
      queued: 0,
      errors: 0,
      isCrawling: false
    };
  }
}

export const crawlerInstance = new Crawler();
