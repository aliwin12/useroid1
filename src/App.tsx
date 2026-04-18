/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Search, Globe, Database, Settings, Activity, Link as LinkIcon, RefreshCcw, ExternalLink, ChevronRight, X, ArrowUp, ArrowDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";

// Use lazy initialization to prevent crashes if the key is missing
let aiInstance: any = null;
const getAI = () => {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is missing. External search will be disabled.");
      return null;
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

type SearchProvider = 'Nexus' | 'Google' | 'Bing' | 'Yandex' | 'Rambler' | 'Mail.ru';

interface SearchResult {
  id: string;
  url: string;
  title: string;
  description: string;
  snippet: string;
  score: number;
  source: SearchProvider;
}

interface ProviderConfig {
  id: SearchProvider;
  enabled: boolean;
  priority: number;
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'Nexus', enabled: true, priority: 1 },
  { id: 'Google', enabled: true, priority: 2 },
  { id: 'Bing', enabled: true, priority: 3 },
  { id: 'Yandex', enabled: true, priority: 4 },
  { id: 'Rambler', enabled: true, priority: 5 },
  { id: 'Mail.ru', enabled: true, priority: 6 }
];

interface Stats {
  engine: { documents: number; terms: number };
  crawler: { visited: number; queued: number; errors: number; isCrawling: boolean };
}

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlMaxPages, setCrawlMaxPages] = useState(10);
  const [crawlStatus, setCrawlStatus] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>(() => {
    const saved = localStorage.getItem('useroid_providers');
    return saved ? JSON.parse(saved) : DEFAULT_PROVIDERS;
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('useroid_providers', JSON.stringify(providers));
  }, [providers]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        setStats(data);
      } catch (e) {
        console.error("Failed to fetch stats", e);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setHasSearched(true);
    setResults([]);

    try {
      const activeExternalProviders = providers.filter(p => p.enabled && p.id !== 'Nexus');
      const nexusEnabled = providers.find(p => p.id === 'Nexus')?.enabled;

      let allFoundResults: SearchResult[] = [];

      // 1. Fetch Local (Nexus) Results if enabled
      if (nexusEnabled) {
        try {
          const res = await fetch(`/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, providers: [{ id: 'Nexus', enabled: true, priority: 1 }] })
          });
          const localResults = await res.json();
          allFoundResults = [...allFoundResults, ...localResults];
        } catch (err) {
          console.error("Nexus search failed", err);
        }
      }

      // 2. Fetch External (Metasearch) Results via Gemini Grounding if enabled
      if (activeExternalProviders.length > 0) {
        const ai = getAI();
        if (ai) {
          const providerNames = activeExternalProviders.map(p => p.id).join(', ');
          
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Search the web for "${query}" and provide exactly 10 high-quality search results. 
            For each result, provide: title, url, and a helpful snippet. 
            CRITICAL: Distribute the "source" property among these engines: ${providerNames}. 
            Each result MUST have a "source" property matching one of these names exactly.`,
            config: {
              tools: [{ googleSearch: {} }],
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    url: { type: Type.STRING },
                    description: { type: Type.STRING },
                    snippet: { type: Type.STRING },
                    source: { type: Type.STRING, description: "Must match one of the requested provider names" }
                  },
                  required: ["title", "url", "description", "snippet", "source"]
                }
              }
            }
          });

          if (response.text) {
            const externalResults = JSON.parse(response.text).map((r: any) => ({
              ...r,
              id: `ext-${Math.random().toString(36).substr(2, 9)}`,
              score: 0,
              lastCrawled: Date.now()
            }));
            allFoundResults = [...allFoundResults, ...externalResults];
          }
        } else {
          console.warn("Skipping external search: AI not initialized");
        }
      }

      // 3. Re-sort based on provider priority
      const providerPriorityMap = new Map<string, number>(providers.map(p => [p.id, p.priority]));
      
      const sortedResults = allFoundResults.sort((a, b) => {
        const priorityA = providerPriorityMap.get(a.source) || 999;
        const priorityB = providerPriorityMap.get(b.source) || 999;
        
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return (b.score || 0) - (a.score || 0);
      });

      setResults(sortedResults);
    } catch (e) {
      console.error("Search failed", e);
    } finally {
      setIsSearching(false);
    }
  };

  const moveProvider = (index: number, direction: 'up' | 'down') => {
    const newProviders = [...providers];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newProviders.length) return;

    const temp = newProviders[index];
    newProviders[index] = newProviders[targetIndex];
    newProviders[targetIndex] = temp;

    // Refresh priorities
    newProviders.forEach((p, i) => p.priority = i + 1);
    setProviders(newProviders);
  };

  const toggleProvider = (id: SearchProvider) => {
    setProviders(providers.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  const handleCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrl.trim()) return;

    setCrawlStatus("Starting crawl...");
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: crawlUrl, maxPages: crawlMaxPages })
      });
      const data = await res.json();
      setCrawlStatus(data.message);
      setTimeout(() => setCrawlStatus(null), 3000);
      setCrawlUrl('');
    } catch (e) {
      setCrawlStatus("Crawl failed to start");
    }
  };

  const goHome = () => {
    setHasSearched(false);
    setQuery('');
    setResults([]);
  };

  // Home Component
  if (!hasSearched) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4 font-sans text-gray-900">
        <div className="absolute top-4 right-4 flex gap-4 items-center">
          <button 
            onClick={() => setShowAdmin(!showAdmin)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[584px] text-center"
        >
          <div className="mb-8 select-none">
            <span className="text-7xl font-bold tracking-tighter text-black">
              USEROID
            </span>
            <div className="text-sm text-gray-400 mt-2 font-mono uppercase tracking-[0.2em]">Open Search Engine</div>
          </div>

          <form onSubmit={handleSearch} className="group relative">
            <div className="flex items-center w-full min-h-[46px] px-4 border border-gray-200 rounded-full hover:shadow-md focus-within:shadow-md transition-shadow">
              <Search className="text-gray-400 mr-3" size={18} />
              <input 
                ref={searchInputRef}
                autoFocus
                type="text" 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 outline-none text-base"
              />
            </div>
            
            <div className="mt-8 flex justify-center gap-3">
              <button 
                type="submit"
                className="px-4 py-2 bg-[#f8f9fa] border border-transparent hover:border-gray-200 text-sm text-gray-800 rounded hover:shadow-sm"
              >
                USEROID Search
              </button>
              <button 
                type="button"
                className="px-4 py-2 bg-[#f8f9fa] border border-transparent hover:border-gray-200 text-sm text-gray-800 rounded hover:shadow-sm"
              >
                I'm Feeling Lucky
              </button>
            </div>
          </form>

          {stats && (
            <div className="mt-12 flex justify-center gap-8 text-xs text-gray-400 font-mono">
              <div className="flex items-center gap-2">
                <Database size={12} />
                <span>{stats.engine.documents} Documents</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity size={12} />
                <span>{stats.engine.terms} Terms</span>
              </div>
            </div>
          )}
        </motion.div>

        <AdminPanel 
          isOpen={showAdmin} 
          onClose={() => setShowAdmin(false)} 
          stats={stats} 
          crawlUrl={crawlUrl} 
          setCrawlUrl={setCrawlUrl}
          crawlMaxPages={crawlMaxPages}
          setCrawlMaxPages={setCrawlMaxPages}
          handleCrawl={handleCrawl}
          status={crawlStatus}
          providers={providers}
          toggleProvider={toggleProvider}
          moveProvider={moveProvider}
        />
      </div>
    );
  }

  // Results Component
  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 pb-20">
      <header className="sticky top-0 bg-white border-b border-gray-100 z-10">
        <div className="max-w-[1244px] mx-auto px-4 py-4 flex items-center">
          <button onClick={goHome} className="mr-8 transform transition-transform hover:scale-105 active:scale-95">
            <span className="text-2xl font-bold text-black tracking-tight">
              USEROID
            </span>
          </button>

          <form onSubmit={handleSearch} className="flex-1 max-w-[692px] relative group">
            <div className="flex items-center w-full min-h-[44px] px-4 border border-gray-200 rounded-full shadow-sm hover:shadow-md transition-shadow">
              <input 
                type="text" 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 outline-none text-base"
              />
              <div className="flex items-center border-l pl-3 ml-2 gap-3 text-blue-500">
                <Search className="cursor-pointer" size={20} onClick={() => handleSearch()} />
              </div>
            </div>
          </form>

          <div className="ml-auto hidden md:flex items-center gap-4 text-gray-500">
            <Settings size={20} className="cursor-pointer hover:text-gray-900" onClick={() => setShowAdmin(true)} />
          </div>
        </div>
        
        <div className="max-w-[1244px] mx-auto px-4 overflow-x-auto no-scrollbar">
          <div className="flex gap-x-6 text-sm text-gray-600 ml-[154px]">
            <div className="flex items-center gap-1 px-1 py-3 border-b-2 border-blue-500 text-blue-500 font-medium whitespace-nowrap">
              <Search size={16} /> All
            </div>
            <div className="flex items-center gap-1 px-1 py-3 hover:text-blue-500 cursor-pointer whitespace-nowrap">
              <Globe size={16} /> Web
            </div>
            <div className="flex items-center gap-1 px-1 py-3 hover:text-blue-500 cursor-pointer whitespace-nowrap">
              <LinkIcon size={16} /> Images
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1244px] mx-auto px-4 mt-4 lg:ml-[154px]">
        <div className="text-sm text-gray-500 mb-6">
          About {results.length} results (0.0{Math.floor(Math.random()*9)} seconds)
        </div>

        {isSearching ? (
          <div className="space-y-8 animate-pulse">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="max-w-[652px]">
                <div className="h-4 w-48 bg-gray-200 rounded mb-2"></div>
                <div className="h-6 w-full bg-gray-200 rounded mb-2"></div>
                <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-w-[652px] space-y-10">
            {results.length > 0 ? (
              results.map((result) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={result.id} 
                  className="group"
                >
                  <div className="flex items-center text-xs text-gray-700 truncate mb-1 gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                      result.source === 'Nexus' ? 'bg-blue-100 text-blue-700' :
                      result.source === 'Google' ? 'bg-red-100 text-red-700' :
                      result.source === 'Bing' ? 'bg-green-100 text-green-700' :
                      result.source === 'Yandex' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {result.source}
                    </span>
                    <span className="flex items-center gap-1">
                      {new URL(result.url).hostname}
                    </span>
                    <ChevronRight size={12} className="mx-1 text-gray-400" />
                    <span className="text-gray-500">{new URL(result.url).pathname}</span>
                  </div>
                  <a 
                    href={result.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-xl text-blue-800 hover:underline inline-block mb-1 visited:text-purple-900"
                  >
                    {result.title}
                  </a>
                  <p className="text-sm text-gray-600 leading-relaxed break-words">
                    <span className="text-gray-400 mr-2">{new Date().toLocaleDateString()} —</span>
                    {result.snippet}
                  </p>
                </motion.div>
              ))
            ) : (
              <div className="py-20 text-center text-gray-500">
                <p>Your search - <strong className="text-black">{query}</strong> - did not match any documents.</p>
                <p className="mt-4 text-sm">Suggestions:</p>
                <ul className="list-disc inline-block text-left mt-2">
                  <li>Make sure all words are spelled correctly.</li>
                  <li>Try different keywords.</li>
                  <li>Try more general keywords.</li>
                </ul>
              </div>
            )}
          </div>
        )}
      </main>

      <AdminPanel 
        isOpen={showAdmin} 
        onClose={() => setShowAdmin(false)} 
        stats={stats} 
        crawlUrl={crawlUrl} 
        setCrawlUrl={setCrawlUrl}
        crawlMaxPages={crawlMaxPages}
        setCrawlMaxPages={setCrawlMaxPages}
        handleCrawl={handleCrawl}
        status={crawlStatus}
      />
    </div>
  );
}

function AdminPanel({ isOpen, onClose, stats, crawlUrl, setCrawlUrl, crawlMaxPages, setCrawlMaxPages, handleCrawl, status, providers, toggleProvider, moveProvider }: any) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" 
          />
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto p-6"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Settings className="text-blue-500" /> 
                System Control
              </h2>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                <X size={20} />
              </button>
            </div>

            <section className="mb-10">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Metasearch Providers</h3>
              <div className="space-y-2">
                {providers.map((provider: any, index: number) => (
                  <div key={provider.id} className={`flex items-center gap-3 p-3 rounded-lg border ${provider.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                    <button 
                      onClick={() => toggleProvider(provider.id)}
                      className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${provider.enabled ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300 bg-white'}`}
                    >
                      {provider.enabled && <Check size={14} />}
                    </button>
                    
                    <div className="flex-1 font-medium text-sm">{provider.id}</div>
                    
                    <div className="flex gap-1">
                      <button 
                        disabled={index === 0}
                        onClick={() => moveProvider(index, 'up')}
                        className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button 
                        disabled={index === providers.length - 1}
                        onClick={() => moveProvider(index, 'down')}
                        className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-gray-400 italic">
                * Drag & drop isn't implemented, use arrows to set results priority.
              </p>
            </section>

            <section className="mb-10">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Crawler Station</h3>
              <form onSubmit={handleCrawl} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Seed URL</label>
                  <input 
                    type="url" 
                    placeholder="https://example.com"
                    value={crawlUrl}
                    onChange={(e) => setCrawlUrl(e.target.value)}
                    className="w-full p-2 border border-gray-200 rounded outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Pages</label>
                  <input 
                    type="number" 
                    min="1"
                    max="1000"
                    value={crawlMaxPages}
                    onChange={(e) => setCrawlMaxPages(Number(e.target.value))}
                    className="w-full p-2 border border-gray-200 rounded outline-none"
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={stats?.crawler.isCrawling}
                  className="w-full py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:bg-gray-300 transition-colors flex items-center justify-center gap-2"
                >
                  {stats?.crawler.isCrawling ? <RefreshCcw className="animate-spin" size={18} /> : <Globe size={18} />}
                  {stats?.crawler.isCrawling ? 'Crawling...' : 'Start Indexing'}
                </button>
                {status && (
                  <div className="p-2 bg-green-50 text-green-700 text-sm rounded border border-green-100 italic">
                    {status}
                  </div>
                )}
              </form>
            </section>

            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Live Metrics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="text-xs text-gray-500 mb-1">Documents</div>
                  <div className="text-2xl font-bold font-mono">{stats?.engine.documents || 0}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="text-xs text-gray-500 mb-1">Tokens</div>
                  <div className="text-2xl font-bold font-mono">{stats?.engine.terms || 0}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="text-xs text-gray-500 mb-1">Visited</div>
                  <div className="text-2xl font-bold font-mono">{stats?.crawler.visited || 0}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="text-xs text-gray-500 mb-1">Queued</div>
                  <div className="text-2xl font-bold font-mono">{stats?.crawler.queued || 0}</div>
                </div>
              </div>
            </section>

            <div className="mt-12 pt-8 border-t text-center">
              <p className="text-xs text-gray-400">USEROID Engine v1.0.0-mvp</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

