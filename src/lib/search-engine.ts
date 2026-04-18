import natural from 'natural';
import _ from 'lodash';

export type SearchProvider = 'Nexus' | 'Google' | 'Bing' | 'Yandex' | 'Rambler' | 'Mail.ru';

export interface Document {
  id: string;
  url: string;
  title: string;
  description: string;
  content: string;
  keywords?: string[];
  lastCrawled: number;
  source?: SearchProvider;
}

export interface SearchResult extends Document {
  score: number;
  snippet: string;
}

export interface ProviderConfig {
  id: SearchProvider;
  enabled: boolean;
  priority: number;
}

const Tokenizer = new natural.WordTokenizer();
const Stemmer = natural.PorterStemmer;

export class SearchEngine {
  private index: Map<string, Set<string>> = new Map();
  private documents: Map<string, Document> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;

  constructor() {}

  private tokenize(text: string): string[] {
    const tokens = Tokenizer.tokenize(text.toLowerCase()) || [];
    return tokens.map(t => Stemmer.stem(t));
  }

  public addDocument(doc: Document) {
    const tokens = this.tokenize(`${doc.title} ${doc.description} ${doc.content}`);
    this.documents.set(doc.id, { ...doc, source: doc.source || 'Nexus' });
    this.docLengths.set(doc.id, tokens.length);

    // Update index
    const uniqueTokens = new Set(tokens);
    uniqueTokens.forEach(token => {
      if (!this.index.has(token)) {
        this.index.set(token, new Set());
      }
      this.index.get(token)!.add(doc.id);
    });

    this.recalculateAvgDocLength();
  }

  private recalculateAvgDocLength() {
    if (this.docLengths.size === 0) return;
    const totalLength = Array.from(this.docLengths.values()).reduce((a, b) => a + b, 0);
    this.avgDocLength = totalLength / this.docLengths.size;
  }

  public async search(query: string, providerConfigs?: ProviderConfig[]): Promise<SearchResult[]> {
    const queryTokens = this.tokenize(query);
    const enabledProviders = (providerConfigs || [])
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority);

    if (enabledProviders.length === 0) {
      enabledProviders.push({ id: 'Nexus', enabled: true, priority: 1 });
    }

    const allResultsGroups: SearchResult[][] = await Promise.all(
      enabledProviders.map(p => this.fetchFromProvider(p.id, query, queryTokens))
    );

    const merged: SearchResult[] = [];
    const maxLen = Math.max(...allResultsGroups.map(g => g.length), 0);

    for (let i = 0; i < maxLen; i++) {
      for (const group of allResultsGroups) {
        if (group[i]) {
          merged.push(group[i]);
        }
      }
    }

    return merged;
  }

  private async fetchFromProvider(provider: SearchProvider, query: string, queryTokens: string[]): Promise<SearchResult[]> {
    if (provider === 'Nexus') {
      return this.localSearch(queryTokens);
    }
    return this.mockExternalSearch(provider, query);
  }

  private localSearch(queryTokens: string[]): SearchResult[] {
    const scores: Map<string, number> = new Map();

    queryTokens.forEach(token => {
      const docIds = this.index.get(token);
      if (!docIds) return;

      const df = docIds.size;
      const idf = Math.log((this.documents.size - df + 0.5) / (df + 0.5) + 1);

      docIds.forEach(docId => {
        const doc = this.documents.get(docId);
        if (!doc) return;

        // Simple TF
        const docTokens = this.tokenize(`${doc.title} ${doc.description} ${doc.content}`);
        const tf = docTokens.filter(t => t === token).length;

        // BM25 calculation
        const k1 = 1.2;
        const b = 0.75;
        const docLen = this.docLengths.get(docId) || 0;
        const score = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / this.avgDocLength)));

        // Booster for title matches
        const titleTokens = this.tokenize(doc.title);
        const titleMatchBooster = titleTokens.includes(token) ? 2.5 : 1.0;

        scores.set(docId, (scores.get(docId) || 0) + (score * titleMatchBooster));
      });
    });

    return Array.from(scores.entries())
      .map(([docId, score]) => {
        const doc = this.documents.get(docId)!;
        return {
          ...doc,
          score,
          snippet: this.createSnippet(doc.content, queryTokens)
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private createSnippet(content: string, queryTokens: string[]): string {
    const words = content.split(/\s+/);
    let bestWindow = "";
    let maxMatches = -1;

    for (let i = 0; i < words.length; i++) {
      const window = words.slice(i, i + 30).join(" ");
      const windowTokens = this.tokenize(window);
      const matches = queryTokens.filter(t => windowTokens.includes(t)).length;
      
      if (matches > maxMatches) {
        maxMatches = matches;
        bestWindow = window;
      }
      if (i > 500) break; // Optimization
    }

    return bestWindow.length > 160 ? bestWindow.substring(0, 160) + "..." : bestWindow;
  }

  public getStats() {
    return {
      documents: this.documents.size,
      terms: this.index.size
    };
  }

  private mockExternalSearch(provider: SearchProvider, query: string): SearchResult[] {
    const results: SearchResult[] = [];
    for (let i = 1; i <= 3; i++) {
      results.push({
        id: `${provider}-${i}-${Buffer.from(query).toString('hex').slice(0, 8)}`,
        url: `https://www.example.com/${provider.toLowerCase().replace(/[^a-z]/g, '')}/result-${i}`,
        title: `${query} - ${provider} Result #${i}`,
        description: `This is a sample result for "${query}" from ${provider}.`,
        content: `Full content of the result from ${provider} for the query ${query}. Useful information and links.`,
        snippet: `... ${query} found on ${provider}. This is how a typical search snippet would look for this engine, providing context for the term ...`,
        score: 10 - i,
        lastCrawled: Date.now(),
        source: provider
      });
    }
    return results;
  }

  public getAllDocuments() {
    return Array.from(this.documents.values());
  }
}

export const instance = new SearchEngine();
