// Canned Pixar-movie trivia questions for the mocked Claude response.
//
// Shape matches what generate-questions.ts validates with
// GeneratedQuestionSchema:
//   { prompt, options[4], correctIndex, difficulty, factBlurb, photoQuery }
// All four options must be distinct (case-insensitive) or the Zod refine
// drops the row. Every blurb is real Pixar trivia so the smoke run looks
// like a real generation, not lorem-ipsum.

export interface MockQuestion {
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  difficulty: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  factBlurb: string;
  photoQuery: string;
}

export const PIXAR_20: MockQuestion[] = [
  {
    prompt: "Which Pixar film features a rat who dreams of becoming a chef?",
    options: ["Ratatouille", "Up", "Wall-E", "Coco"],
    correctIndex: 0,
    difficulty: 1,
    factBlurb:
      "Ratatouille (2007) stars Remy, a rat with refined palate, who guides aspiring chef Linguini from inside his toque.",
    photoQuery: "paris kitchen cooking",
  },
  {
    prompt: "What is the name of the elderly widower in the Pixar film Up?",
    options: ["Carl Fredricksen", "Russell", "Charles Muntz", "Ed Asner"],
    correctIndex: 0,
    difficulty: 2,
    factBlurb:
      "Carl Fredricksen lifts his house with thousands of balloons to honor his late wife Ellie's dream of visiting Paradise Falls.",
    photoQuery: "balloons sky adventure",
  },
  {
    prompt: "What is the small robot left behind on Earth called in Wall-E?",
    options: ["Wall-E", "Eve", "M-O", "Auto"],
    correctIndex: 0,
    difficulty: 1,
    factBlurb:
      "WALL-E stands for Waste Allocation Load Lifter: Earth-Class — the last of his kind, compacting trash on a deserted planet.",
    photoQuery: "rusty robot trash",
  },
  {
    prompt: "What kind of fish is Nemo from Finding Nemo?",
    options: ["Clownfish", "Royal Blue Tang", "Goldfish", "Pufferfish"],
    correctIndex: 0,
    difficulty: 1,
    factBlurb:
      "Nemo is an ocellaris clownfish; his father Marlin shares the species. Dory the forgetful sidekick is the blue tang.",
    photoQuery: "clownfish anemone reef",
  },
  {
    prompt: "In Coco, what is the name of the Land of the Dead skeleton who befriends Miguel?",
    options: ["Hector", "Ernesto de la Cruz", "Pepita", "Dante"],
    correctIndex: 0,
    difficulty: 2,
    factBlurb:
      "Hector — voiced by Gael Garcia Bernal — turns out to be Miguel's great-great-grandfather and the real composer of 'Remember Me'.",
    photoQuery: "day of the dead marigolds",
  },
  {
    prompt: "Which toy in Toy Story is Andy's favorite at the start of the franchise?",
    options: ["Woody", "Buzz Lightyear", "Mr. Potato Head", "Rex"],
    correctIndex: 0,
    difficulty: 1,
    factBlurb:
      "Sheriff Woody is Andy's prized toy until Buzz Lightyear arrives at his birthday party in the 1995 original.",
    photoQuery: "cowboy toy ranch",
  },
  {
    prompt: "What city does the main character of Ratatouille live in?",
    options: ["Paris", "Lyon", "London", "Florence"],
    correctIndex: 0,
    difficulty: 1,
    factBlurb:
      "Remy ends up under the rooftops of Paris, working at the (fictional) Gusteau's restaurant.",
    photoQuery: "paris rooftops eiffel tower",
  },
  {
    prompt: "What does the acronym M.O. stand for in Wall-E?",
    options: ["Microbe Obliterator", "Mobile Operative", "Maintenance Officer", "Master Overlord"],
    correctIndex: 0,
    difficulty: 5,
    factBlurb:
      "M-O — Microbe Obliterator — is the obsessive cleaning robot aboard the Axiom who chases WALL-E's dirty tread marks.",
    photoQuery: "white cleaning robot",
  },
  {
    prompt: "In Monsters, Inc., what city do the monsters live in?",
    options: ["Monstropolis", "Boo Town", "Scareville", "Doormont"],
    correctIndex: 0,
    difficulty: 3,
    factBlurb:
      "Monstropolis is powered by the screams of human children — at least until the monsters discover that laughter generates ten times as much energy.",
    photoQuery: "neon city monsters",
  },
  {
    prompt: "What is the name of Sulley's young human friend in Monsters, Inc.?",
    options: ["Boo", "Mary", "Riley", "Penny"],
    correctIndex: 0,
    difficulty: 2,
    factBlurb:
      "Boo's real name is Mary Gibbs, the daughter of a Pixar story artist; the production recorded her giggling around the studio.",
    photoQuery: "toddler pigtails purple",
  },
  {
    prompt: "Which Pixar film centers on the emotions inside an 11-year-old girl's head?",
    options: ["Inside Out", "Brave", "Soul", "Turning Red"],
    correctIndex: 0,
    difficulty: 1,
    factBlurb:
      "Inside Out (2015) features Joy, Sadness, Anger, Fear, and Disgust running the control center inside Riley's mind.",
    photoQuery: "control room colorful brain",
  },
  {
    prompt: "What is the make of the rusted-out tow truck in the Cars franchise?",
    options: ["1955 Chevrolet GMC", "1957 Ford F-100", "1951 International Harvester", "1960 Dodge Power Wagon"],
    correctIndex: 2,
    difficulty: 6,
    factBlurb:
      "Mater is based on a 1951 International Harvester boom truck — Pixar art director Bob Pauley sketched him from a real wreck he saw in Galena, Kansas.",
    photoQuery: "rusty tow truck desert",
  },
  {
    prompt: "What kind of bird does the boy scout encounter in Up?",
    options: ["Snipe", "South American Tropical Bird Kevin", "Albatross", "Condor"],
    correctIndex: 1,
    difficulty: 4,
    factBlurb:
      "Kevin is a fictional flightless tropical bird; despite being named by Russell, Kevin is later revealed to be female with chicks.",
    photoQuery: "tropical colorful bird jungle",
  },
  {
    prompt: "What weapon does Merida from Brave master?",
    options: ["Sword", "Bow and arrow", "Spear", "Axe"],
    correctIndex: 1,
    difficulty: 2,
    factBlurb:
      "Merida is an expert archer — her independence is established when she shoots for her own hand in the betrothal contest.",
    photoQuery: "scotland archery castle",
  },
  {
    prompt: "What was Pixar's first feature-length film?",
    options: ["A Bug's Life", "Toy Story", "Monsters, Inc.", "Finding Nemo"],
    correctIndex: 1,
    difficulty: 3,
    factBlurb:
      "Toy Story (1995) was the first fully computer-animated feature film ever released; it was directed by John Lasseter.",
    photoQuery: "vintage toys bedroom",
  },
  {
    prompt: "Who composed the iconic score for Up's opening montage 'Married Life'?",
    options: ["Michael Giacchino", "Randy Newman", "Hans Zimmer", "Thomas Newman"],
    correctIndex: 0,
    difficulty: 5,
    factBlurb:
      "Michael Giacchino won an Academy Award for the Up score; 'Married Life' is consistently ranked among the most affecting four minutes of animation ever made.",
    photoQuery: "vintage piano sheet music",
  },
  {
    prompt: "What sea creature is Hank, Dory's reluctant companion in Finding Dory?",
    options: ["Octopus (technically a 'septopus' — he has seven arms)", "Squid", "Jellyfish", "Cuttlefish"],
    correctIndex: 0,
    difficulty: 4,
    factBlurb:
      "Hank lost a tentacle and only has seven, so technically a 'septopus' — voiced by Ed O'Neill in the 2016 sequel.",
    photoQuery: "octopus tentacles tank",
  },
  {
    prompt: "What instrument does Miguel play in Coco?",
    options: ["Guitar", "Violin", "Piano", "Trumpet"],
    correctIndex: 0,
    difficulty: 1,
    factBlurb:
      "Miguel sneaks into a mausoleum to borrow Ernesto de la Cruz's white guitar, accidentally cursing himself into the Land of the Dead.",
    photoQuery: "acoustic guitar courtyard",
  },
  {
    prompt: "Which Pixar short played before Finding Nemo?",
    options: ["Knick Knack", "Boundin'", "Jack-Jack Attack", "Lifted"],
    correctIndex: 1,
    difficulty: 7,
    factBlurb:
      "Boundin' (2003) was a charming country-music short by Bud Luckey that ran before Finding Nemo theatrically.",
    photoQuery: "sheep meadow mountain",
  },
  {
    prompt: "What color is the orb the new probe Eve is sent to find in Wall-E?",
    options: ["Green (a living plant)", "Red", "Blue", "Yellow"],
    correctIndex: 0,
    difficulty: 3,
    factBlurb:
      "EVE — Extraterrestrial Vegetation Evaluator — is searching for any sign of plant life that would let humanity return to Earth.",
    photoQuery: "small green sprout soil",
  },
];

export const PIXAR_RETRY_5: MockQuestion[] = [
  {
    prompt: "What does the 'A113' Easter egg refer to in Pixar films?",
    options: [
      "A classroom number at CalArts",
      "Pixar's original office address",
      "Steve Jobs' favorite coordinates",
      "An animator's birthday",
    ],
    correctIndex: 0,
    difficulty: 6,
    factBlurb:
      "A113 was the classroom where many Pixar founders studied animation at CalArts; it appears in every Pixar feature as a hidden tribute.",
    photoQuery: "classroom hallway numbers",
  },
  {
    prompt: "What is the name of the family in The Incredibles?",
    options: ["Parr", "Strong", "Power", "Pearson"],
    correctIndex: 0,
    difficulty: 2,
    factBlurb:
      "Bob and Helen Parr — Mr. Incredible and Elastigirl — raise three super-powered kids: Violet, Dash, and Jack-Jack.",
    photoQuery: "family superhero suburb",
  },
  {
    prompt: "What is Sulley's full name in Monsters, Inc.?",
    options: [
      "James P. Sullivan",
      "Sullivan Smith",
      "Stewart P. Sulley",
      "John Sulleyford",
    ],
    correctIndex: 0,
    difficulty: 4,
    factBlurb:
      "James P. Sullivan is the top scarer at Monsters, Inc. — voiced by John Goodman in every appearance.",
    photoQuery: "blue furry monster",
  },
  {
    prompt: "Soul (2020) follows a music teacher trying to reach which afterlife realm?",
    options: ["The Great Before", "The Land of Dreams", "The Inkwell", "The Quiet Place"],
    correctIndex: 0,
    difficulty: 5,
    factBlurb:
      "Joe Gardner gets stuck in The Great Before — where unborn souls are matched with personalities before being sent to Earth.",
    photoQuery: "abstract blue souls clouds",
  },
  {
    prompt: "Which actress voices Joy in Inside Out?",
    options: ["Amy Poehler", "Tina Fey", "Mindy Kaling", "Phyllis Smith"],
    correctIndex: 0,
    difficulty: 3,
    factBlurb:
      "Amy Poehler voices Joy; Phyllis Smith voices Sadness, Lewis Black voices Anger, Bill Hader voices Fear, and Mindy Kaling voices Disgust.",
    photoQuery: "happy yellow sparkles",
  },
];
