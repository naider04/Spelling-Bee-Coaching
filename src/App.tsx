/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from "motion/react";
import { Mic, MicOff, RotateCcw, Volume2, CheckCircle2, XCircle, ChevronRight, Zap, Eye, EyeOff } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { db, auth, initAuth, OperationType, handleFirestoreError } from "./lib/firebase";
import { setDoc, doc, addDoc, collection, serverTimestamp, updateDoc, increment } from "firebase/firestore";

// Register speech recognition for TypeScript
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const WORDS_BY_LEVEL: Record<string, string[]> = {
  Beginner: [
    "Book", "Help", "Finger", "Teacher", "Potato", "Play", "Shoes", "Sport", "Night", "Think", 
    "Often", "Water", "Notebook", "Country", "Children", "Look", "Spoon", "Near", "Movie", "Make", 
    "Feel", "Face", "Between", "Nature", "Father", "Boy", "Flower", "Monday", "Sneakers", "Always", 
    "Tree", "Bottle", "Speak", "Small", "Bored", "Person", "Gate", "Please", "Computer", "Close", 
    "Strong", "Pencil", "Friend", "People", "Answer", "Rich", "Wash", "School", "Break", "Activity"
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
    "Astonishing", "Ambiguous", "Anxious", "Apprehensive", "Articulate", "Assertive", "Assimilate", "Autonomous", "Benevolent", "Brevity", 
    "Capricious", "Camouflage", "Coherence", "Colloquial", "Conscientious", "Controversial", "Convoluted", "Divulge", "Dilemma", "Discrepancy", 
    "Eloquent", "Empirical", "Encounter", "Enigmatic", "Ephemeral", "Foster", "Fairness", "Filmmaker", "Hypothetical", "Impeccable", 
    "Importune", "Indispensable", "Ineffable", "Judgemental", "Meticulous", "Neighborhood", "Obsolete", "Paradox", "Perseverance", "Plausible", 
    "Pragmatic", "Predicament", "Redundant", "Reiterate", "Resilient", "Sophisticated", "Spontaneous", "Subtle", "Unnecessary", "Taxonomy", 
    "Wisdom", "Chiaroscurist"
  ],
  Master: [
    "Acknowledgment", "Acquaintance", "Architecture", "Biochemistry", "Compliance", "Camouflage", "Conscientious", "Controversial", 
    "Dehydration", "Disappearance", "Embarrassing", "Environmentally", "Exaggeration", "Flabbergasted", "Handkerchief", "Hypothetical", 
    "Independence", "Irreplaceable", "Knowledgeable", "Misunderstood", "Overwhelming", "Psychologist", "Quarantine", "Recommendable", "Unbelievable"
  ]
};

const PHONETIC_GROUPS: Record<string, string[]> = {
  'b': ['b', 'p', 'v', 'd'],
  'p': ['p', 'b', 'v', 'd'],
  'v': ['v', 'b', 'p', 'd'],
  'd': ['d', 't', 'v', 'b'],
  't': ['t', 'd'],
  'c': ['z', 'c'],
  'z': ['z', 'c'],
  'a': ['a', 'ei', 'asd']
};

const LETTER_NAMES: Record<string, string> = {
  "bee": "b", "cee": "c", "dee": "d", "gee": "g", "jay": "j", "kay": "k", "pee": "p", "cue": "q",
  "are": "r", "ess": "s", "tee": "t", "you": "u", "vee": "v", "double": "w", "ex": "x", "why": "y",
  "zee": "z", "zed": "z", "aitch": "h", "en": "n", "em": "m", "oh": "o", "eff": "f", "ell": "l",
  "eye": "i", "see": "c", "double-u": "w"
};

const VARIANTS: Record<string, string[]> = {
  "practice": ["practice", "practise"],
  "improve": ["improve"],
  "predicament": ["predicament"]
};

const FORCE_LETTER_MODE = ["wisdom", "observe", "ambiguous"];

const LEVELS = ["Beginner", "Intermediate", "Senior", "Master"];

const WORDS_ALLOWED_AUTOCORRECT = new Set([
  "sophisticated", "anxious", "assertive", "misunderstood", "observe", 
  "wash", "embarrassing", "unnecessary", "serious", "obsolete", 
  "psychologist", "small", "impeccable", "answer", "foster", "astonishing", "unbelievable", "accurate"
]);

const PHONETIC_MAP: Record<string, string> = {
  "i am": "im",
  "i'm": "im",
  "ima": "im",
  "okay": "ok",
  "ok": "ok",
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
  "double you": "w",
  "double-u": "w"
};

export default function App() {
  const [user, setUser] = useState<{ id: string, name: string } | null>(null);
  const [userNameInput, setUserNameInput] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);

  const [selectedLevels, setSelectedLevels] = useState<string[]>(["Beginner", "Intermediate", "Senior", "Master"]);
  const [wordLists, setWordLists] = useState<Record<string, string>>({
    Beginner: WORDS_BY_LEVEL.Beginner.join(", "),
    Intermediate: WORDS_BY_LEVEL.Intermediate.join(", "),
    Senior: WORDS_BY_LEVEL.Senior.join(", "),
    Master: WORDS_BY_LEVEL.Master.join(", ")
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPhoneMode, setIsPhoneMode] = useState(false);
  const [attemptHistory, setAttemptHistory] = useState<{ text: string, status: "✅" | "❌" }[]>([]);

  const currentWords = useMemo(() => {
    let allWords: string[] = [];
    
    selectedLevels.forEach(level => {
      const text = wordLists[level] || "";
      const parsed = text
        .split(/[,\n\s]+/)
        .map(w => w.trim())
        .filter(w => w.length > 0 && w.length < 50);
      allWords = [...allWords, ...parsed];
    });

    const shuffled = allWords.length > 0 ? [...allWords].sort(() => Math.random() - 0.5) : ["No Words Selected"];
    return shuffled;
  }, [selectedLevels, wordLists]);
  
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [spelledText, setSpelledText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [isWordHidden, setIsWordHidden] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micSyncOffset, setMicSyncOffset] = useState(0.6); // Default 0.6s as requested
  const isSpeakingRef = useRef(false);
  const isTransitioningRef = useRef(false);
  const ttsTimerRef = useRef<any>(null);
  const transitionTimerRef = useRef<any>(null);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
  }, []);

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
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  
  const recognitionRef = useRef<any>(null);

  const currentWord = currentWords[currentWordIndex] || currentWords[0] || "Default";
  const targetWord = currentWord.toLowerCase();

  // Helper functions for Phone Mode
  const isSimilarLetter = (a: string, b: string) => {
    if (a === b) return true;
    const group = PHONETIC_GROUPS[a] || [a];
    return group.includes(b);
  };

  const compareLetterSequences = (spoken: string[], target: string[]) => {
    if (spoken.length !== target.length) return false;
    return spoken.every((char, i) => isSimilarLetter(char, target[i]));
  };

  const decodeLetterNames = (transcript: string) => {
    const wordsSpoken = transcript.toLowerCase().split(/\s+/);
    return wordsSpoken.map(w => LETTER_NAMES[w] || w).join('');
  };

  const isWholeWordSpeech = (transcript: string) => {
    const words = transcript.trim().split(/\s+/);
    if (words.length === 1) {
      // If it's just one word and it's longer than 2 characters, it's definitely a word pronunciation
      return words[0].length > 2;
    }
    const longWords = words.filter(w => w.length > 1);
    return longWords.length > words.length / 2;
  };

  const handleImPattern = (transcript: string, targetWord: string) => {
    const lowerTarget = targetWord.toLowerCase();
    if (!lowerTarget.startsWith('im')) return false;
    const iamMatch = transcript.match(/^\s*i\s+am\s+(.+)$/i);
    if (iamMatch) {
      const letters = iamMatch[1].trim().split(/\s+/).map(part => part[0].toLowerCase()).join('');
      const expectedLetters = lowerTarget.substring(2);
      if (compareLetterSequences(letters.split(''), expectedLetters.split(''))) return true;
    }
    const imMatch = transcript.match(/^\s*i\s+m\s+(.+)$/i);
    if (imMatch) {
      const letters = imMatch[1].trim().split(/\s+/).map(part => part[0].toLowerCase()).join('');
      const expectedLetters = lowerTarget.substring(2);
      if (compareLetterSequences(letters.split(''), expectedLetters.split(''))) return true;
    }
    return false;
  };

  const handleUnPattern = (transcript: string, targetWord: string) => {
    const lowerTarget = targetWord.toLowerCase();
    if (!lowerTarget.startsWith('un')) return false;
    const match = transcript.match(/^\s*you\s+and\s+(.+)$/i);
    if (match) {
      const letters = match[1].trim().split(/\s+/).map(p => p[0].toLowerCase()).join('');
      const expected = lowerTarget.substring(2);
      return compareLetterSequences(letters.split(''), expected.split(''));
    }
    return false;
  };

  const handleThePattern = (transcript: string, targetWord: string) => {
    const theMatch = transcript.match(/^\s*the\s+(.+)$/i);
    if (theMatch) {
      const letters = theMatch[1].trim().split(/\s+/).map(part => part[0].toLowerCase()).join('');
      const expectedLetters = targetWord.toLowerCase();
      if (compareLetterSequences(letters.split(''), expectedLetters.split(''))) return true;
    }
    return false;
  };

  const handleLetterByLetterSpelling = (transcript: string, targetWord: string) => {
    const cleanTranscript = transcript.replace(/^\s*the\s+/i, '').trim();
    const spokenLetters = cleanTranscript.split(/\s+/).map(part => part[0].toLowerCase());
    const targetLetters = targetWord.toLowerCase().split('');
    if (spokenLetters.length === targetLetters.length && compareLetterSequences(spokenLetters, targetLetters)) return true;
    return false;
  };

  const isSpellingMatch = useCallback((transcript: string, targetWord: string) => {
    const possibleTargets = VARIANTS[targetWord.toLowerCase()] || [targetWord];
    const cleanTranscriptFull = transcript.toLowerCase().trim();
    
    for (const tgt of possibleTargets) {
      const lowerTgt = tgt.toLowerCase();
      
      // PRIORITY: extract first letters (fixes "psychology" issue)
      const wordsOnly = cleanTranscriptFull.split(/\s+/);
      const startIdx = (wordsOnly[0] === 'the') ? 1 : 0;
      const extracted = wordsOnly.slice(startIdx).map(w => w[0]).join('');

      if (extracted.length === lowerTgt.length && 
          compareLetterSequences(extracted.split(''), lowerTgt.split(''))) return true;

      // Restore specific substitution patterns
      if (lowerTgt.startsWith('im') && handleImPattern(cleanTranscriptFull, lowerTgt)) return true;
      if (lowerTgt.startsWith('un') && handleUnPattern(cleanTranscriptFull, lowerTgt)) return true;
      if (handleThePattern(cleanTranscriptFull, lowerTgt)) return true;
      if (handleLetterByLetterSpelling(cleanTranscriptFull, lowerTgt)) return true;

      // Handle letter-by-letter names (bee, see, etc.)
      const decodedLetters = decodeLetterNames(cleanTranscriptFull);
      if (decodedLetters.length === lowerTgt.length && decodedLetters.replace(/[^a-z]/g, '') === lowerTgt) return true;

      const spokenLettersNoSpaces = cleanTranscriptFull.replace(/\s+/g, '').toLowerCase();
      if (spokenLettersNoSpaces.length === lowerTgt.length && 
          compareLetterSequences(spokenLettersNoSpaces.split(''), lowerTgt.split(''))) return true;
    }
    return false;
  }, [handleImPattern, handleUnPattern, handleThePattern, handleLetterByLetterSpelling, decodeLetterNames]);

  const addAttempt = useCallback((text: string, isCorrect: boolean) => {
    setAttemptHistory(prev => [{ text, status: isCorrect ? "✅" : "❌" }, ...prev].slice(0, 50));
    
    // Log mistake to Firebase if incorrect and user is logged in
    if (!isCorrect && user) {
      const spelledTextClean = (spelledText + interimText).replace(/\s/g, "");
      const targetChar = targetWord[spelledTextClean.length] || "";
      const inputChar = text[0] || ""; // Taking first char of utterance as mistake input

      addDoc(collection(db, "mistakes"), {
        userId: user.id,
        userName: user.name,
        targetWord: targetWord,
        targetChar: targetChar,
        inputChar: inputChar,
        timestamp: serverTimestamp()
      }).catch(e => handleFirestoreError(e, OperationType.CREATE, "mistakes"));
    }
  }, [user, spelledText, interimText, targetWord]);

  // Voice synthesis
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || isMuted || text === "No Words Selected") return;
    
    // Cancel any current speech to prevent overlapping or queuing
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.85; 
    utterance.pitch = 1.0;
    
    utterance.onstart = () => {
      setIsSpeaking(true);
      
      // Stop recognition if it's running to avoid noise/echo
      if (isListeningRef.current) {
        try {
          recognitionRef.current?.stop();
        } catch (e) {
          // Ignore
        }
      }
      
      // Attempt to "predict" the end if offset is positive
      if (micSyncOffset > 0) {
        if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
        
        // Very rough estimate: (chars * 0.1s / rate) - offset
        // We add a safety floor
        const estimatedDurationMs = Math.max(200, (text.length * 110 / 0.85) - (micSyncOffset * 1000));
        
        ttsTimerRef.current = setTimeout(() => {
          if (isSpeakingRef.current) {
            handleTTSEnd();
          }
        }, estimatedDurationMs);
      }
    };

    const handleTTSEnd = () => {
      if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
      if (!isSpeakingRef.current) return;

      setIsSpeaking(false);
      
      // Always restart mic after TTS ends if isListening is true
      if (isListeningRef.current) {
        // If we were transitioning, we definitely want to restart now.
        // If not transitioning, standard auto-restart is handled by onend, 
        // but since we explicitly stopped it onstart, we need to restart it here.
        isTransitioningRef.current = false;
        try {
          if (recognitionRef.current && recognitionRef.current.readyState !== 'listening') {
            recognitionRef.current?.start();
          }
        } catch (e) {
          console.warn("Post-TTS mic start failed:", e);
        }
      }
    };

    utterance.onend = handleTTSEnd;
    utterance.onerror = () => setIsSpeaking(false);
    
    window.speechSynthesis.speak(utterance);
  }, [isMuted, micSyncOffset]);

  // Auto-pronounce word when it changes
  useEffect(() => {
    if (currentWords.length > 0 && currentWords[0] !== "No Words Selected") {
      speak(currentWord);
    }
  }, [currentWord, speak]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Unified character matching logic
  const matchChar = useCallback(
    (idx: number, inputChar: string) => {
      const targetChar = targetWord[idx]?.toLowerCase();
      if (!targetChar || !inputChar) return false;

      const lowerInput = inputChar.toLowerCase();

      // 2. Direct match
      if (lowerInput === targetChar) return true;

      // 3. Phonetic groups (b/p/v, t/d, etc)
      const phoneticGroup = PHONETIC_GROUPS[targetChar] || [targetChar];
      if (phoneticGroup.includes(lowerInput)) return true;

      // 4. User-defined equivalents
      const equivalents: Record<string, string[]> = {
        v: ["d", "b"],
        d: ["v", "z", "t", "b"],
        z: ["d"],
        b: ["p", "v", "d"],
        p: ["b"],
        t: ["d"],
        a: ["asd", "a"],
        o: ["ok", "okay", "o"],
        k: ["ok", "okay", "k"]
      };

      return equivalents[targetChar]?.includes(lowerInput) || false;
    },
    [targetWord]
  );

  // Phonetic cleaning with anti-pronunciation check
  const processSegment = useCallback((text: string, currentSpelling: string) => {
    // 1. Pre-process for patterns like "I am" or "SM"
    const lowerText = text.toLowerCase().trim();
    if (!lowerText) return "";
    
    // Quick match for targetWord (autocorrected whole word) - ONLY for whitelisted words
    const lowerTextNoSpaces = lowerText.replace(/\s+/g, "");

    // Check for specific misrecognition phrases first
    const isStarterMatch =
      (targetWord === "astonishing" &&
        (lowerText.startsWith("asd") || lowerTextNoSpaces.startsWith("asd"))) ||
      (targetWord === "unbelievable" &&
        (lowerText.includes("you and") || lowerTextNoSpaces.includes("youand"))) ||
      (targetWord === "accurate" &&
        (lowerText.startsWith("acc") || lowerTextNoSpaces.startsWith("acc")));

    const isAutocorrectMatch =
      WORDS_ALLOWED_AUTOCORRECT.has(targetWord) &&
      (lowerText === targetWord ||
        lowerTextNoSpaces === targetWord ||
        (isStarterMatch && lowerText.length > 5)); // Guard against too short starter matches

    if (isAutocorrectMatch) {
      if (
        targetWord.length > 6 &&
        currentSpelling.length < 2 && // Require at least some spelling effort for long words
        !isStarterMatch
      ) {
        return ""; 
      }
      return targetWord;
    }

    // Special case for "I am" pattern observed in logs
    if (lowerText.startsWith("i am ") && targetWord.toLowerCase().startsWith("im")) {
      const rest = lowerText.substring(5).replace(/\s/g, "");
      const targetRest = targetWord.toLowerCase().substring(2);
      if (rest === targetRest || (targetRest[0] && rest[0] === targetRest[0])) {
         return "im" + rest;
      }
    }

    // Split by whitespace to get distinct utterances, filter out empty segments
    let rawSegments = lowerText.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").split(/\s+/).filter(s => s.length > 0);
    
    let currentIdx = currentSpelling.length;
    let result = "";
    
    for (const rawSegment of rawSegments) {
      let segment = rawSegment;
      
      // Check direct phonetic transcript map (bee -> b, etc)
      if (PHONETIC_MAP[segment]) segment = PHONETIC_MAP[segment];
      
      // 1. Try to match as a multi-character block if segment is short (2-4 chars)
      if (segment.length > 1 && segment.length <= 4 && segment.length < targetWord.length) {
        const targetSlice = targetWord.substring(currentIdx, currentIdx + segment.length).toLowerCase();
        if (targetSlice.length === segment.length) {
          let subMatch = true;
          for (let i = 0; i < segment.length; i++) {
            if (!matchChar(currentIdx + i, segment[i])) {
              subMatch = false;
              break;
            }
          }

          if (subMatch) {
            result += targetSlice;
            currentIdx += segment.length;
            continue;
          }
        }
      }

      // 2. Fallback to single/normalized char matching
      if (matchChar(currentIdx, segment)) {
        // SUCCESS: Use the CORRECT target character for the UI
        result += targetWord[currentIdx]?.toLowerCase() || "";
        currentIdx++;
      } else if (segment.length === 1) {
        result += segment;
        currentIdx++;
      } else if (segment.length <= 3 && segment[0]) {
        result += segment[0] || "";
        currentIdx++;
      }
    }

    return result || "";
  }, [targetWord, matchChar]);

  const initRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("Speech recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false; // More reliable on mobile than continuous=true
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      if (isSpeakingRef.current || isTransitioningRef.current) return;

      let currentFinal = "";
      let currentInterim = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinal += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }

      if (isPhoneMode) {
        const display = (currentInterim + currentFinal).toLowerCase().trim();
        if (display) setInterimText(display);
        else setInterimText("");

        if (currentFinal) {
          const spokenRaw = currentFinal.trim();
          const transcriptNormalized = spokenRaw.toLowerCase();
          setDebugLog(prev => [spokenRaw, ...prev].slice(0, 16));

          // Extract letters and check
          const words = spokenRaw.split(/\s+/);
          const extracted = words.map(w => w[0]).join('').toLowerCase();
          const target = targetWord;

          // ✅ If extracted letters match -> ACCEPT (even if engine merged it)
          if (extracted.length === target.length && compareLetterSequences(extracted.split(''), target.split(''))) {
            setIsListening(false);
            recognitionRef.current?.stop();
            handleCorrect(targetWord);
            return;
          }

          // ❌ ONLY reject if clearly a real word (not letters)
          if (!FORCE_LETTER_MODE.includes(target) && isWholeWordSpeech(spokenRaw)) {
            addAttempt("Spell it letter by letter", false);
            setInterimText("");
            setDebugLog(prev => ["⚠️ You must spell the word", ...prev].slice(0, 10));
            recognitionRef.current?.stop();
            return;
          }

          // 🔥 THEN check correctness
          if (isSpellingMatch(transcriptNormalized, targetWord)) {
            setIsListening(false);
            recognitionRef.current?.stop();
            handleCorrect(targetWord);
          } else {
            addAttempt(spokenRaw, false);
            setInterimText(""); // Clear interim on wrong final result to match mobile.html's blink behavior
            setDebugLog(prev => [`❌ Not correct. Say letters like: ${targetWord.split('').join(' ')}`, ...prev].slice(0, 10));
            recognitionRef.current?.stop();
          }
        }
        return;
      }

      // Update Debug Log
        if (currentFinal || currentInterim) {
          const logText = currentFinal || currentInterim;
          setDebugLog(prev => [logText, ...prev].slice(0, 16));

          // Quick check for whole word match (autocorrect fix)
          const transcriptFull = (currentFinal || currentInterim).toLowerCase().trim().replace(/[.,!?]/g, "");
          const normalizedNoSpaces = transcriptFull.replace(/\s+/g, "");
          
          const QUICK_ACCEPTS: Record<string, string[]> = {
            "obsolete": ["obsolete"],
            "observe": ["observe"],
            "unbelievable": ["unbelievable", "you and"],
            "sophisticated": ["sophisticated"],
            "small": ["small"],
            "anxious": ["anxios", "anxious"],
            "astonishing": ["asd"],
            "accurate": ["acc"]
          };

          const isDirectMatch =
            WORDS_ALLOWED_AUTOCORRECT.has(targetWord.toLowerCase()) &&
            (transcriptFull === targetWord.toLowerCase() ||
              normalizedNoSpaces === targetWord.toLowerCase());

          const isQuickAccept = (QUICK_ACCEPTS[targetWord.toLowerCase()] || []).some(
            (q) => {
              const qNoSpaces = q.replace(/\s+/g, "");
              // Strict matching for quick accepts to avoid over-triggering
              return transcriptFull === q || normalizedNoSpaces === qNoSpaces;
            }
          );

          if (isDirectMatch || isQuickAccept) {
            const isKnownExceptionMatch = 
              (targetWord.toLowerCase() === "astonishing" && (transcriptFull.startsWith("asd") || normalizedNoSpaces.startsWith("asd"))) ||
              (targetWord.toLowerCase() === "unbelievable" && (transcriptFull.includes("you and") || normalizedNoSpaces.includes("youand"))) ||
              (targetWord.toLowerCase() === "accurate" && (transcriptFull.startsWith("acc ") || normalizedNoSpaces === "acc"));

            const isHeuristicLongWord = targetWord.length > 6;
            // Significant effort requirement: strictly enforced for all autocorrect matches
            // Require at least 2 chars spelled for most words, or 1 for longer ones with partial match
            const hasSpellingEffort = spelledText.length >= 2 || (targetWord.length >= 5 && spelledText.length >= 1);

            // Special block for "small" vs "SM"
            const isOnlySM = targetWord.toLowerCase() === "small" && (transcriptFull === "sm" || normalizedNoSpaces === "sm") && spelledText.length < 2;

            if (!isOnlySM && (hasSpellingEffort || isKnownExceptionMatch)) {
              recognitionRef.current?.stop();
              handleCorrect(targetWord);
              return;
            }
          }
        }

        if (currentFinal) {
          setSpelledText(prev => {
            const cleanedSegment = processSegment(currentFinal, prev);
            
            // If the cleaned segment IS the target word, just set it to the target word
            if (cleanedSegment.toLowerCase() === targetWord.toLowerCase()) {
              return targetWord.toLowerCase();
            }
            
            return (prev + cleanedSegment).toLowerCase();
          });
        }
      
      setInterimText(processSegment(currentInterim || "", spelledText) || "");
    };

    recognition.onerror = (event: any) => {
      // Ignore 'aborted' error as it's often triggered by intentional restarts/transitions
      if (event.error === "aborted") return;

      // Handle the 'no-speech' error which is common when the user is quiet
      if (event.error === "no-speech") {
        setDebugLog(prev => ["(Mic active, waiting for speech...)", ...prev].slice(0, 10));
        return;
      }

      console.error("Speech recognition error", event.error);
      setDebugLog(prev => [`Error: ${event.error}`, ...prev].slice(0, 10));
      
      // Log Mic Error to Firebase
      if (user) {
        addDoc(collection(db, "mic_errors"), {
          userId: user.id,
          userName: user.name,
          errorType: event.error,
          browser: navigator.userAgent,
          timestamp: serverTimestamp()
        }).catch(e => handleFirestoreError(e, OperationType.CREATE, "mic_errors"));
      }

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
      // Auto-restart pattern from mobile.html - only restart if NOT speaking
      if (isListeningRef.current && !isTransitioningRef.current && !isSpeakingRef.current) {
        setTimeout(() => {
          if (isListeningRef.current && !isSpeakingRef.current) {
            try {
              recognitionRef.current?.start();
            } catch (e) {
              console.warn("Restart failed:", e);
            }
          }
        }, 200);
      }
    };

    recognitionRef.current = recognition;
  }, [processSegment]); // Updated from cleanSpelling

  const resetWordProgress = useCallback(() => {
    setSpelledText("");
    setInterimText("");
    setStatus("idle");
    // setDebugLog([]); // KEEP LOG PERSISTENT
  }, []);

  const nextWord = useCallback(() => {
    setCurrentWordIndex((prev) => (prev + 1) % currentWords.length);
    resetWordProgress();
  }, [currentWords.length, resetWordProgress]);

  const handleCorrect = useCallback((word: string) => {
    setStatus("correct");
    addAttempt(word, true);
    setSpelledText(word.toLowerCase()); // Ensure UI shows correct spelling regardless of phonetic substitutes used
    setInterimText("..."); // Less dramatic transition text
    setDebugLog(prev => ["✅ Perfect! Next word...", ...prev].slice(0, 16));
    isTransitioningRef.current = true;
    
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => {
      nextWord();
      isTransitioningRef.current = false;
      transitionTimerRef.current = null;
      
      // Force mic restart if it should be listening but stopped
      if (isListeningRef.current) {
        try {
          if (recognitionRef.current && recognitionRef.current.readyState !== 'listening') {
            recognitionRef.current?.start();
          }
        } catch (e) {
          // Ignore "already started" errors
        }
      }
    }, 1200);
  }, [addAttempt, nextWord]);

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
          setDebugLog(prev => ["Restarting mic...", ...prev].slice(0, 10));
        }
      }, 50);
    }
  };

  // Check correctness
  useEffect(() => {
    if (isPhoneMode || currentWords[0] === "No Words Selected") return;

    const currentFullSpelling = (spelledText + interimText).replace(/\s/g, "");
    
    // Check if the total spelled sequence effectively matches correctly
    let allCorrect = true;
    if (currentFullSpelling.length !== targetWord.length) {
      allCorrect = false;
    } else {
      for (let i = 0; i < targetWord.length; i++) {
        if (!matchChar(i, currentFullSpelling[i])) {
          allCorrect = false;
          break;
        }
      }
    }

    if (allCorrect && status !== "correct") {
      handleCorrect(targetWord);
    } else if (currentFullSpelling.length > 0 && status !== "correct" && !isTransitioningRef.current) {
      // Incremental error checking
      let hasError = false;
      for (let i = 0; i < currentFullSpelling.length; i++) {
          if (!matchChar(i, currentFullSpelling[i])) {
              hasError = true;
              break;
          }
      }
      setStatus(hasError ? "error" : "idle");
    } else if (currentFullSpelling.length === 0 && status !== "correct") {
      setStatus("idle");
    }
  }, [spelledText, interimText, targetWord, matchChar, currentWords, handleCorrect, status]);

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

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userNameInput.trim()) return;
    
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const authUser = await initAuth();
      if (!authUser) {
        setLoginError("Could not connect to authentication service. Please ensure 'Anonymous Sign-in' is enabled in your Firebase console.");
        return;
      }

      const userRef = doc(db, "users", authUser.uid);
      await setDoc(userRef, {
        name: userNameInput.trim(),
        totalTimeSeconds: 0,
        lastActive: serverTimestamp()
      });
      
      setUser({ id: authUser.uid, name: userNameInput.trim() });
      
      // Start Session
      const sessionRef = await addDoc(collection(db, "sessions"), {
        userId: authUser.uid,
        userName: userNameInput.trim(),
        startTime: serverTimestamp()
      });
      sessionIdRef.current = sessionRef.id;
      sessionStartTimeRef.current = Date.now();
    } catch (error: any) {
      console.error("Login failed:", error);
      if (error.code === "permission-denied") {
        setLoginError("Permission denied. Check your Firestore rules.");
      } else {
        setLoginError("Login failed: " + (error.message || "Unknown error"));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Session cleanup and time tracking
  useEffect(() => {
    const handleUnload = () => {
      if (user && sessionIdRef.current && sessionStartTimeRef.current) {
        const duration = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000);
        const sessionRef = doc(db, "sessions", sessionIdRef.current);
        const userRef = doc(db, "users", user.id);
        
        // These are fire-and-forget on unload, though navigator.sendBeacon is better for real apps
        updateDoc(sessionRef, {
          endTime: serverTimestamp(),
          durationSeconds: duration
        });
        updateDoc(userRef, {
          totalTimeSeconds: increment(duration),
          lastActive: serverTimestamp()
        });
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => {
      handleUnload();
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [user]);

  // Periodic heartbeat to update time
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (user && sessionStartTimeRef.current) {
         const now = Date.now();
         const incrementalDuration = Math.floor((now - sessionStartTimeRef.current) / 1000);
         // Update user total time periodically
         const userRef = doc(db, "users", user.id);
         updateDoc(userRef, {
           totalTimeSeconds: increment(incrementalDuration),
           lastActive: serverTimestamp()
         });
         sessionStartTimeRef.current = now; // Reset offset for next interval
      }
    }, 60000); // Every minute
    return () => clearInterval(interval);
  }, [user]);

  const currentLevelColor = useMemo(() => {
    // Find which level this word belongs to
    const level = Object.entries(wordLists).find(([_, text]) => {
      const words = (text as string).toLowerCase().split(/[,\n\s]+/).map(w => w.trim());
      return words.includes(currentWord.toLowerCase());
    })?.[0] || "Beginner";

    switch(level) {
      case "Beginner": return "emerald";
      case "Intermediate": return "blue";
      case "Senior": return "indigo";
      case "Master": return "violet";
      default: return "emerald";
    }
  }, [currentWord, wordLists]);

  const isBlocked = isListening && (isSpeaking || status === "correct" || isTransitioningRef.current);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Login Overlay */}
      {!user && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md px-6">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white p-8 md:p-12 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-white"
          >
            <div className="text-center space-y-4 mb-8">
              <div className="w-16 h-16 bg-amber-400 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-lg border border-amber-300">🐝</div>
              <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Welcome!</h2>
              <p className="text-sm text-slate-500 font-medium">Please enter your name to start your practice session and track your progress.</p>
            </div>
            
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Your Full Name</label>
                <input 
                  autoFocus
                  required
                  type="text" 
                  value={userNameInput}
                  onChange={(e) => setUserNameInput(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full h-14 px-6 bg-slate-50 border-2 border-slate-100 rounded-2xl text-lg font-bold focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-300"
                />
              </div>

              {loginError && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs font-semibold leading-relaxed">
                  {loginError}
                </div>
              )}

              <button 
                disabled={isLoggingIn || !userNameInput.trim()}
                className="w-full h-14 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white font-black rounded-2xl shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-3"
              >
                {isLoggingIn ? "Starting..." : "Start Practice"}
                {!isLoggingIn && <ChevronRight className="w-5 h-5" />}
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Navigation Bar - Spelling Bee UNEMI 2026 */}
      <nav className="h-16 px-4 md:px-10 flex items-center justify-between border-b border-slate-200 bg-white shadow-sm shrink-0 sticky top-0 z-50">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 md:w-9 md:h-9 bg-amber-400 rounded-xl flex items-center justify-center text-lg md:text-xl shadow-inner border border-amber-300">
            🐝
          </div>
          <div className="flex flex-col">
            <span className="font-black tracking-tighter text-sm md:text-xl text-slate-900 leading-none">
              SPELLING BEE <span className="text-blue-600">UNEMI</span>
            </span>
            <span className="text-[8px] md:text-[10px] font-bold text-slate-400 tracking-[0.2em] md:tracking-[0.3em] uppercase">2026 EDITION</span>
          </div>
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
                    className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2 space-y-2"
                  >
                    <div className="grid grid-cols-2 gap-1 mb-2">
                      {LEVELS.map(level => (
                        <button
                          key={level}
                          onClick={() => toggleLevel(level)}
                          className={`
                            w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] md:text-xs font-bold transition-all
                            ${selectedLevels.includes(level) 
                              ? (level === "Beginner" ? 'bg-emerald-50 text-emerald-700' : 
                                 level === "Intermediate" ? 'bg-blue-50 text-blue-700' :
                                 level === "Senior" ? 'bg-indigo-50 text-indigo-700' :
                                 'bg-violet-50 text-violet-700')
                              : 'text-slate-400 hover:bg-slate-50'}
                          `}
                        >
                          {level}
                          {selectedLevels.includes(level) && (
                            <CheckCircle2 className={`w-3 h-3 ${
                              level === "Beginner" ? 'text-emerald-500' : 
                              level === "Intermediate" ? 'text-blue-500' :
                              level === "Senior" ? 'text-indigo-500' :
                              'text-violet-500'
                            }`} />
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-3 px-1 custom-scrollbar">
                      {selectedLevels.map(level => (
                        <div key={level} className="space-y-1.5 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                          <div className="flex items-center justify-between">
                            <label className={`text-[10px] font-black uppercase tracking-wider ${
                              level === 'Beginner' ? 'text-emerald-500' :
                              level === 'Intermediate' ? 'text-blue-500' :
                              level === 'Senior' ? 'text-indigo-500' :
                              'text-violet-500'
                            }`}>
                              {level} Words
                            </label>
                            <button
                              onClick={() => setWordLists(prev => ({ 
                                ...prev, 
                                [level]: WORDS_BY_LEVEL[level].join(", ") 
                              }))}
                              className="text-[9px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded-md hover:bg-slate-50"
                              title={`Restore default ${level} words`}
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              Restore
                            </button>
                          </div>
                          <textarea
                            value={wordLists[level]}
                            onChange={(e) => setWordLists(prev => ({ ...prev, [level]: e.target.value }))}
                            placeholder={`Enter ${level} words...`}
                            className="w-full h-24 px-2 py-1.5 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500/10 focus:border-slate-400 transition-all resize-none"
                          />
                        </div>
                      ))}
                    </div>
                    
                    <div className="border-t border-slate-100 pt-2 px-2 pb-1">
                      <p className="text-[9px] text-slate-400 leading-tight">
                        Separate each word using a <span className="font-bold">comma</span>, <span className="font-bold">space</span>, or <span className="font-bold">new line</span>.
                      </p>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>


        </div>
      </nav>

      {/* Main Practice Area */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 md:px-20 py-8 space-y-8">
        {/* Word Challenge Header - Sized Reduced to 28%/30% */}
        <div className="text-center space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            {isPhoneMode ? "PHONE MODE ACTIVE" : "CURRENT WORD"}
          </span>
          <motion.h1
            key={currentWord}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`text-[1.8rem] md:text-[2.5rem] font-black tracking-tight text-slate-900 uppercase transition-all duration-300 relative ${isWordHidden ? 'blur-xl select-none' : ''}`}
          >
            {isWordHidden ? "••••••" : currentWord}
          </motion.h1>
          
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button 
              onClick={() => speak(currentWord)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-all text-[11px] font-bold uppercase tracking-widest shadow-md shadow-blue-100 active:scale-95"
            >
              <Volume2 className="w-4 h-4" />
              Listen
            </button>
            <button 
              onClick={() => setIsWordHidden(!isWordHidden)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all text-[11px] font-bold uppercase tracking-widest active:scale-95 ${isWordHidden ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-100'}`}
              title={isWordHidden ? "Unhide Word" : "Hide Word"}
            >
              {isWordHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              {isWordHidden ? "Unhide" : "Hide"}
            </button>
            
            {/* Button "start spelling" removed per request */}
          </div>
        </div>

        {/* Attempt History - Only in Phone Mode */}
        <AnimatePresence>
          {isPhoneMode && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full max-w-2xl bg-amber-50/50 rounded-3xl border border-amber-100 p-4 space-y-3"
            >
              <div className="flex items-center gap-2 px-2 border-b border-amber-200 pb-2">
                <RotateCcw className="w-3 h-3 text-amber-600" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-900/50">History Log</span>
              </div>
              <div className="flex flex-col gap-2 max-h-32 overflow-y-auto px-1">
                {attemptHistory.length === 0 ? (
                  <p className="text-[10px] text-amber-800/40 italic text-center py-4">No attempts yet. Start spelling...</p>
                ) : (
                  attemptHistory.map((attempt, i) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={i} 
                      className="flex items-center gap-3 bg-white/60 p-2 rounded-xl border border-white"
                    >
                      <span className="text-xs">{attempt.status}</span>
                      <span className="text-xs font-medium text-amber-950 font-mono">{attempt.text}</span>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Spelling Card */}
        <div className="w-full max-w-2xl min-h-[140px] bg-white rounded-[2rem] border-2 border-slate-200 shadow-xl flex flex-col items-center justify-center gap-4 p-6 relative overflow-hidden">
          {/* Microphone Status Banner */}
          <div className={`absolute top-0 left-0 right-0 h-6 flex items-center justify-center transition-colors ${isListening ? 'bg-blue-50' : 'bg-slate-50'}`}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`}></div>
              <span className={`text-[9px] font-bold uppercase tracking-widest ${isListening ? 'text-blue-600' : 'text-slate-400'}`}>
                {isListening ? (isBlocked ? "System Busy" : "Listening, speak now") : "Microphone Off"}
              </span>
            </div>
          </div>

          {/* Phone Mode Transcription Display */}
          <AnimatePresence>
            {isPhoneMode && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full flex flex-col gap-4"
              >
                {/* Live Area styled from mobile.html */}
                <div className="bg-[#eef2ff] rounded-[38px] px-[18px] py-[8px] min-h-[60px] flex items-center justify-center text-center shadow-inner border border-blue-50">
                  <div className="text-[#0a2f44] font-mono font-medium text-lg break-words">
                    {interimText || ""}
                  </div>
                </div>
                
                {/* Status Badge - Removed Box with "🎧 Ready — Press Start Spelling" */}
                {isListening && (
                  <div className="bg-[#dee5f0] text-[#1f3b4c] text-[14px] font-medium px-6 py-2.5 rounded-full self-center flex items-center gap-2 shadow-sm">
                    <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-blue-500 animate-pulse' : 'bg-slate-400'}`}></div>
                    <span>
                      {debugLog[0]?.startsWith("❌") || debugLog[0]?.startsWith("⚠️") ? debugLog[0] : (debugLog[0] ? `👂 "${debugLog[0]}"` : "Listening...")}
                    </span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Letter Grid - Only show if not hide mode, or show dots */}
          {!isPhoneMode && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-wrap gap-2 md:gap-4 justify-center items-center mt-4"
            >
              {targetWord.split('').map((char, idx) => {
                const combined = (spelledText || "") + (interimText || "");
                const spelledChar = combined[idx];
                const isCorrect = matchChar(idx, spelledChar);
                const isPending = !spelledChar;
                const isWrong = spelledChar && !isCorrect;

                return (
                  <motion.span
                    key={idx}
                    className={`
                      text-2xl md:text-5xl font-mono font-bold leading-none
                      ${isPending ? 'text-slate-200' : ''}
                      ${isCorrect ? 'text-emerald-500' : ''}
                      ${isWrong ? 'text-red-500' : ''}
                    `}
                  >
                    {spelledChar || "_"}
                  </motion.span>
                );
              })}
            </motion.div>
          )}

                {/* Correct Feedback Text (Simple) */}
          <AnimatePresence>
            {status === "correct" && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-emerald-500 font-bold uppercase tracking-[0.3em] text-sm md:text-base animate-bounce"
              >
                ✓ Correct!
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col items-center gap-6 w-full">
          <div className="flex flex-col items-center gap-2">
            {/* Charging Bar for Mic Readiness */}
            <div className="w-48 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <AnimatePresence mode="wait">
                {isBlocked && (
                  <motion.div
                    key="progress"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ 
                      duration: status === "correct" ? 1 : 2, // 1s for next word, ~2s estimated for TTS
                      ease: "linear",
                      repeat: Infinity
                    }}
                    className="h-full bg-red-500"
                  />
                )}
              </AnimatePresence>
            </div>
            
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
                  w-20 h-20 rounded-full flex items-center justify-center text-white shadow-lg active:scale-95 relative
                  ${(isListening && !isBlocked) ? 'scale-110 opacity-100' : 'scale-90 opacity-80'}
                  ${isListening 
                    ? (isBlocked ? 'bg-red-500 shadow-red-200' : 'bg-blue-500 shadow-blue-200 ring-4 ring-blue-100') 
                    : 'bg-red-500 shadow-red-200 hover:bg-red-600'}
                `}
              >
                {isListening ? (isBlocked ? <MicOff size={32} strokeWidth={2.5} /> : <Mic size={32} strokeWidth={2.5} />) : <MicOff size={32} strokeWidth={2.5} />}
                
                {isListening && !isBlocked && (
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
        </div>

        {/* Debug Log Interface - Visible only in Bee Mode or for devs */}
        {!isPhoneMode && (
          <div className="w-full max-w-sm bg-slate-900/5 rounded-xl p-3 font-mono text-[9px] text-slate-500 space-y-1">
            <p className="border-b border-slate-200 pb-1 mb-1 font-bold uppercase opacity-50 flex justify-between items-center">
              <span className="flex items-center gap-2">
                Mic Input Log (Last 16)
                <button 
                  onClick={() => {
                    const logText = debugLog.join('\n');
                    navigator.clipboard.writeText(logText);
                    setShowCopiedToast(true);
                    setTimeout(() => setShowCopiedToast(false), 2000);
                  }}
                  className="bg-slate-200 hover:bg-slate-300 text-[8px] px-1.5 py-0.5 rounded transition-colors text-slate-600 relative"
                >
                  {showCopiedToast ? "Copied!" : "Copy Log"}
                  <AnimatePresence>
                    {showCopiedToast && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-slate-800 text-white text-[10px] font-bold rounded-lg shadow-lg whitespace-nowrap pointer-events-none"
                      >
                        Copied to clipboard! 📋
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              </span>
              {isListening && !isBlocked && <span className="text-blue-500 animate-pulse">● Live</span>}
              {isListening && isBlocked && <span className="text-red-500 animate-pulse">● System Busy</span>}
            </p>
            {debugLog.length === 0 ? (
              <p className="opacity-30 italic">No input yet...</p>
            ) : (
              <div className="max-h-48 overflow-y-auto scrollbar-hide">
                {debugLog.map((log, i) => (
                  <p key={i} className="truncate select-all transition-all border-b border-slate-100 last:border-0 py-0.5">{`>> ${log}`}</p>
                ))}
              </div>
            )}
          </div>
        )}
        </div>

        {/* Footer Branding */}
        <footer className="w-full mt-auto py-8 flex flex-col items-center gap-2 opacity-30">
          <div className="h-px w-12 bg-slate-200" />
          <p className="text-[9px] font-black tracking-[0.5em] uppercase text-slate-900">
            Spelling Bee <span className="text-blue-600">UNEMI</span> 2026
          </p>
        </footer>
      </main>
    </div>
  );
}
