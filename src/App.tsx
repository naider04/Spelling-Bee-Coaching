/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from "motion/react";
import { Mic, MicOff, RotateCcw, Volume2, CheckCircle2, XCircle, ChevronRight, Zap } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// Register speech recognition for TypeScript
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const WORDS_BY_LEVEL: Record<string, string[]> = {
  Beginner: [
    "Activity", "Always", "Answer", "Between", "Book", "Bored", "Bottle", "Boy", "Break", 
    "Children", "Close", "Computer", "Country", "Face", "Father", "Feel", "Finger", "Flower", 
    "Friend", "Gate", "Help", "Look", "Make", "Monday", "Movie", "Nature", "Near", "Night", 
    "Notebook", "Often", "Pencil", "People", "Play", "Please", "Potato", "Rich", "School", 
    "Shoes", "Small", "Speak", "Spoon", "Sport", "Strong", "Teacher", "Think", "Tree", "Wash", "Water"
  ],
  Intermediate: [
    "Accurate", "Adventure", "Balance", "Calendar", "Career", "Challenge", "Complete", "Control", 
    "Curious", "Decide", "Discover", "Energy", "Famous", "Focus", "Gather", "Honest", "Imagine", 
    "Improve", "Journey", "Knowledge", "Language", "Member", "Message", "Notice", "Observe", 
    "Outside", "Package", "Patient", "Perfect", "Popular", "Practice", "Prepare", "Present", 
    "Protect", "Provide", "Quickly", "Reason", "Respect", "Result", "Secret", "Serious", 
    "Special", "Student", "Suggest", "Talent", "Travel", "Useful", "Vacation", "Welcome", "Yesterday"
  ],
  Senior: [
    "Ambiguous", "Anxious", "Apprehensive", "Articulate", "Assertive", "Assimilate", "Astonishing", 
    "Autonomous", "Benevolent", "Brevity", "Camouflage", "Capricious", "Coherence", "Colloquial", 
    "Conscientious", "Controversial", "Convoluted", "Dilemma", "Discrepancy", "Divulge", "Eloquent", 
    "Empirical", "Encounter", "Enigmatic", "Ephemeral", "Fairness", "Filmmaker", "Foster", 
    "Hypothetical", "Impeccable", "Importune", "Indispensable", "Ineffable", "Judgemental", 
    "Meticulous", "Neighborhood", "Obsolete", "Paradox", "Perseverance", "Plausible", "Pragmatic", 
    "Predicament", "Redundant", "Reiterate", "Resilient", "Sophisticated", "Spontaneous", "Subtle", 
    "Taxonomy", "Unnecessary", "Wisdom"
  ],
  Master: [
    "Acknowledgment", "Acquaintance", "Architecture", "Biochemistry", "Camouflage", "Compliance", 
    "Conscientious", "Controversial", "Dehydration", "Disappearance", "Embarrassing", "Environmentally", 
    "Exaggeration", "Flabbergasted", "Handkerchief", "Hypothetical", "Independence", "Irreplaceable", 
    "Knowledgeable", "Misunderstood", "Overwhelming", "Psychologist", "Quarantine", "Recommendable", "Unbelievable"
  ]
};

const LEVELS: ("Beginner" | "Intermediate" | "Senior" | "Master")[] = ["Beginner", "Intermediate", "Senior", "Master"];

const PHONETIC_MAP: Record<string, string> = {
  "i am": "im",
  "i'm": "im",
  "ima": "im",
  "okay": "ok",
  "bee": "b",
  "see": "c",
  "sea": "c",
  "tea": "t",
  "you": "u",
  "are": "r",
  "eye": "i",
  "oh": "o",
  "aitch": "h",
  "jay": "j",
  "kay": "k",
  "ell": "l",
  "em": "m",
  "en": "n",
  "ar": "r",
  "ess": "s",
  "vee": "v",
  "ex": "x",
  "why": "y",
  "zee": "z",
  "double you": "w"
};

export default function App() {
  const [selectedLevels, setSelectedLevels] = useState<string[]>(["Beginner", "Intermediate", "Senior", "Master"]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  const currentWords = useMemo(() => {
    const filtered = selectedLevels.flatMap(level => WORDS_BY_LEVEL[level] || []);
    return filtered.length > 0 ? filtered : ["No Words Selected"];
  }, [selectedLevels]);
  
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [spelledText, setSpelledText] = useState("");
  const [interimText, setInterimText] = useState("");

  // Reset progress when words change
  useEffect(() => {
    setCurrentWordIndex(0);
    setSpelledText("");
    setInterimText("");
    setStatus("idle");
  }, [currentWords]);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "correct" | "error" | "validating">("idle");
  const [isMuted, setIsMuted] = useState(false);
  
  const recognitionRef = useRef<any>(null);

  const currentWord = currentWords[currentWordIndex] || currentWords[0] || "Default";
  const targetWord = currentWord.toLowerCase();

  // Voice synthesis
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || isMuted || text === "No Words Selected") return;
    
    // Cancel any current speech to prevent overlapping or queuing
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.85; // Slightly slower for better clarity in spelling contests
    utterance.pitch = 1.0;
    
    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  // Auto-pronounce word when it changes
  useEffect(() => {
    if (currentWords.length > 0 && currentWords[0] !== "No Words Selected") {
      speak(currentWord);
    }
  }, [currentWord, speak]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Phonetic cleaning with anti-pronunciation check
  const cleanSpelling = useCallback((text: string) => {
    // Split by whitespace to get distinct utterances
    let rawSegments = text.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").trim().split(/\s+/);
    
    let cleaned = rawSegments.map(segment => {
      // 1. Check direct phonetic map (e.g., "double you", "em", "en")
      if (PHONETIC_MAP[segment]) return PHONETIC_MAP[segment];
      
      // 2. If it's a single letter, it's valid spelling
      if (segment.length === 1) return segment;
      
      // 3. Special case for "i am" or "i'm" which might not split correctly depending on browser
      if (segment === "im" || segment === "i'm") return "im";

      // 4. Fallback: if the segment is short (2-3 chars) and not the target word, 
      // maybe it's a misheard letter. Let's try to take just the first char.
      if (segment.length <= 3 && segment !== targetWord) {
        return segment[0];
      }

      // 5. Reject anything longer than 3 chars as it's likely a whole word pronunciation
      return "";
    }).join("");

    return cleaned;
  }, [targetWord]);

  // Fuzzy Match Check
  const isCharCorrect = useCallback((idx: number, inputChar: string) => {
    const targetChar = targetWord[idx];
    if (!inputChar) return false;
    if (inputChar === targetChar) return true;
    
    const equivalents: Record<string, string[]> = {
      'v': ['d'],
      'd': ['v', 'z'],
      'z': ['d'],
      'b': ['p'],
      'p': ['b']
    };

    return equivalents[targetChar]?.includes(inputChar) || false;
  }, [targetWord]);

  const initRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("Speech recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let currentFinal = "";
      let currentInterim = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinal += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }

      // Update Debug Log
      if (currentFinal || currentInterim) {
        setDebugLog(prev => [currentFinal || currentInterim, ...prev].slice(0, 5));
      }

      if (currentFinal) {
        setSpelledText(prev => {
          const cleanedSegment = cleanSpelling(currentFinal);
          return prev + cleanedSegment;
        });
      }
      
      setInterimText(cleanSpelling(currentInterim));
    };

    recognition.onerror = (event: any) => {
      // Handle the 'no-speech' error which is common when the user is quiet
      if (event.error === "no-speech") {
        setDebugLog(prev => ["(Mic active, waiting for speech...)", ...prev].slice(0, 5));
        return;
      }

      console.error("Speech recognition error", event.error);
      setDebugLog(prev => [`Error: ${event.error}`, ...prev].slice(0, 5));
      
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setIsListening(false);
        setStatus("error");
      }
      
      if (event.error === "network") {
        setIsListening(false);
        setStatus("error");
        console.warn("Network error detected. Speech recognition paused.");
      }
    };

    recognition.onend = () => {
      // Only restart if the user still wants the mic on
      if (isListeningRef.current) {
        try {
          recognitionRef.current?.start();
        } catch (e) {
          // If start fails (e.g. already starting), wait a bit and try once more if still listening
          setTimeout(() => {
            if (isListeningRef.current) {
              try {
                recognitionRef.current?.start();
              } catch (secondErr) {
                console.warn("Auto-restart failed twice:", secondErr);
                setIsListening(false);
              }
            }
          }, 300);
        }
      }
    };

    recognitionRef.current = recognition;
  }, [cleanSpelling]); // Removed isListening from dependencies to avoid unnecessary re-initializations

  const toggleMic = () => {
    if (isListening) {
      setIsListening(false);
      try {
        recognitionRef.current?.stop();
      } catch (e) {
        console.warn("Stop failed:", e);
      }
    } else {
      setIsListening(true);
      if (!recognitionRef.current) {
        initRecognition();
      }
      
      // Delay slightly to allow any previous instance to fully clear if needed
      setTimeout(() => {
        try {
          recognitionRef.current?.start();
        } catch (e) {
          console.error("Manual start failed:", e);
          setDebugLog(prev => ["Restarting mic...", ...prev].slice(0, 5));
        }
      }, 100);
    }
  };

  const resetWordProgress = useCallback(() => {
    setSpelledText("");
    setInterimText("");
    setStatus("idle");
    setDebugLog([]);
  }, []);

  const nextWord = useCallback(() => {
    setCurrentWordIndex((prev) => (prev + 1) % currentWords.length);
    resetWordProgress();
  }, [currentWords.length, resetWordProgress]);

  // Check correctness
  useEffect(() => {
    if (currentWords[0] === "No Words Selected") return;

    const currentFullSpelling = (spelledText + interimText).replace(/\s/g, "");
    
    // Check if the total spelled sequence effectively matches correctly (fuzzy allowed)
    let allCorrect = true;
    for (let i = 0; i < targetWord.length; i++) {
        if (i < currentFullSpelling.length) {
            if (!isCharCorrect(i, currentFullSpelling[i])) {
                allCorrect = false;
                break;
            }
        } else {
            allCorrect = false;
            break;
        }
    }

    if (allCorrect && currentFullSpelling.length === targetWord.length) {
      setStatus("correct");
      const timer = setTimeout(nextWord, 1000);
      return () => clearTimeout(timer);
    } else if (currentFullSpelling.length > 0) {
      // Incremental error checking
      let hasError = false;
      for (let i = 0; i < currentFullSpelling.length; i++) {
          if (!isCharCorrect(i, currentFullSpelling[i])) {
              hasError = true;
              break;
          }
      }
      setStatus(hasError ? "error" : "idle");
    } else {
      setStatus("idle");
    }
  }, [spelledText, interimText, targetWord, isCharCorrect, currentWords, nextWord]);

  useEffect(() => {
    initRecognition();
    return () => recognitionRef.current?.stop();
  }, [initRecognition]);

  const toggleLevel = (level: string) => {
    setSelectedLevels(prev => {
      if (prev.includes(level)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter(l => l !== level);
      }
      return [...prev, level];
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Navigation Bar - Spelling Bee UNEMI 2026 */}
      <nav className="h-16 px-6 md:px-10 flex items-center justify-between border-b border-slate-200 bg-white shadow-sm shrink-0 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-400 rounded-lg flex items-center justify-center text-lg">
            🐝
          </div>
          <span className="font-bold tracking-tight text-xl text-amber-900 hidden sm:inline">Spelling Bee UNEMI 2026</span>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Level Selector Menu */}
          <div className="relative">
            <button 
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-700 transition-colors"
            >
              LEVELS ({selectedLevels.length})
              <ChevronRight className={`w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-90' : ''}`} />
            </button>

            <AnimatePresence>
              {isMenuOpen && (
                <>
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsMenuOpen(false)}
                    className="fixed inset-0 bg-transparent z-40"
                  />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2 space-y-1"
                  >
                    {LEVELS.map(level => (
                      <button
                        key={level}
                        onClick={() => toggleLevel(level)}
                        className={`
                          w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all
                          ${selectedLevels.includes(level) 
                            ? 'bg-amber-50 text-amber-700' 
                            : 'text-slate-400 hover:bg-slate-50'}
                        `}
                      >
                        {level}
                        {selectedLevels.includes(level) && <CheckCircle2 className="w-3 h-3" />}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <div className="text-[10px] font-mono tabular-nums bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-100 hidden md:block">
            WORD {currentWordIndex + 1}/{currentWords.length}
          </div>
        </div>
      </nav>

      {/* Main Practice Area */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 md:px-20 py-8 space-y-8">
        {/* Word Challenge Header - Sized Reduced to 28%/30% */}
        <div className="text-center space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Current Word</span>
          <motion.h1 
            key={currentWord}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-[1.8rem] md:text-[2.5rem] font-black tracking-tight text-slate-900 uppercase"
          >
            {currentWord}
          </motion.h1>
          <button 
            onClick={() => speak(currentWord)}
            className="flex items-center gap-2 mx-auto px-4 py-1.5 rounded-full text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-all text-[9px] font-bold uppercase tracking-widest"
          >
            <Volume2 className="w-3 h-3" />
            Listen
          </button>
        </div>

        {/* Spelling Card */}
        <div className="w-full max-w-2xl min-h-[140px] bg-white rounded-[2rem] border-2 border-slate-200 shadow-xl flex flex-col items-center justify-center gap-4 p-6 relative overflow-hidden">
          {/* Microphone Status Banner */}
          <div className={`absolute top-0 left-0 right-0 h-6 flex items-center justify-center transition-colors ${isListening ? 'bg-blue-50' : 'bg-slate-50'}`}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`}></div>
              <span className={`text-[9px] font-bold uppercase tracking-widest ${isListening ? 'text-blue-600' : 'text-slate-400'}`}>
                {isListening ? "Listening, speak now" : "Microphone Off"}
              </span>
            </div>
          </div>

          {/* Letter Grid - Reduced to 28% on phones */}
          <div className="flex flex-wrap gap-2 md:gap-4 justify-center items-center mt-4">
            {targetWord.split('').map((char, idx) => {
              const spelledChar = (spelledText + interimText)[idx];
              const isCorrect = isCharCorrect(idx, spelledChar);
              const isPending = !spelledChar;
              const isWrong = spelledChar && !isCorrect;

              return (
                <motion.span
                  key={idx}
                  className={`
                    text-[1rem] md:text-5xl font-mono font-bold leading-none
                    ${isPending ? 'text-slate-200' : ''}
                    ${isCorrect ? 'text-emerald-500' : ''}
                    ${isWrong ? 'text-red-500' : ''}
                  `}
                >
                  {spelledChar || "_"}
                </motion.span>
              );
            })}
          </div>

          {/* Correct Feedback Text (Simple) */}
          <AnimatePresence>
            {status === "correct" && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-emerald-600 font-bold uppercase tracking-[0.3em] text-xs"
              >
                Correct!
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col items-center gap-6 w-full">
          <div className="flex items-center gap-6">
            <button 
              onClick={resetWordProgress}
              className="w-12 h-12 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-slate-900 transition-colors shadow-sm flex items-center justify-center"
              title="Reset Spelling"
            >
              <RotateCcw size={20} />
            </button>
            
            <button 
              onClick={toggleMic}
              className={`
                w-20 h-20 rounded-full flex items-center justify-center text-white shadow-lg transition-all active:scale-95 relative
                ${isListening ? 'bg-blue-500 shadow-blue-200 ring-4 ring-blue-100' : 'bg-red-500 shadow-red-200 hover:bg-red-600'}
              `}
            >
              {isListening ? <Mic size={32} strokeWidth={2.5} /> : <MicOff size={32} strokeWidth={2.5} />}
              
              {isListening && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
                  <motion.div 
                    animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="w-full h-full rounded-full border-4 border-white"
                  />
                </div>
              )}
            </button>

            <button 
              onClick={nextWord}
              className="w-12 h-12 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-slate-900 transition-colors shadow-sm flex items-center justify-center"
              title="Skip Word"
            >
              <ChevronRight size={24} />
            </button>
          </div>

          {/* Debug Log Interface if listening */}
          {isListening && debugLog.length > 0 && (
            <div className="w-full max-w-sm bg-slate-900/5 rounded-xl p-3 font-mono text-[9px] text-slate-500 space-y-1">
              <p className="border-b border-slate-200 pb-1 mb-1 font-bold uppercase opacity-50">Mic Input Log (Last 5)</p>
              {debugLog.map((log, i) => (
                <p key={i} className="truncate select-all">{`>> ${log}`}</p>
              ))}
            </div>
          )}

          <div className="flex gap-2 p-1 bg-slate-200/50 rounded-lg text-[10px] font-bold text-slate-500 uppercase tracking-tight">
            <span className="px-2 py-1 bg-white rounded shadow-sm text-blue-600">UNEMI 2026 Engine</span>
            <span className="px-2 py-1">Phoneme Mapping V2.1</span>
          </div>
        </div>
      </main>

      {/* Word List Footer */}
      <footer className="h-24 bg-white border-t border-slate-200 px-6 flex items-center gap-4 overflow-hidden shrink-0">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide no-scrollbar">
          {currentWords.map((word, idx) => (
            <div 
              key={idx}
              className={`
                px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all shrink-0
                ${idx === currentWordIndex 
                  ? 'bg-amber-100 border border-amber-200 text-amber-700' 
                  : 'bg-slate-50 text-slate-300 font-medium'}
              `}
            >
              {word}
            </div>
          ))}
        </div>
      </footer>

    </div>
  );
}
