#!/usr/bin/env node

const setup = require("./lib/setup");
const request = require('./lib/request');
const cli = require('clui');
const parser = require('node-html-parser');
const chalk = require('chalk');

const websites = {
  mcdonalds: 'https://www.mcdfoodforthoughts.com',
  tacobell: null,
  burgerking: null
};

const questionAnswers = {
  mcdonalds: {
    'R000005': 3,
    'R000002': 5,
    'R000009': 5,
    'R000020': 5,
    'R000010': 5,
    'R000016': 5,
    'R000008': 5,
    'R000143': 5,
    'R000019': 5,
    'R000012': 5,
    'R000011': 5,
    'R000017': 5,
    'R000021': 5,
    'R000026': 2,
    'R000031': 5,
    'R000034': '',
    'R000044': 1,
    'R000052': 1,
    'R000168': 2,
    'R000141': 2,
    'R000057': 1,
    'R000064': 9,
    'R000065': 9,
    'R000054': 2,
    'R000383': 1,
    'S000068': 'Terry',
    'S000073': 'Mcdonald',
    'S000070': '%%email%%',
    'S000071': '%%email%%'
  }
};

// Helper to sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const runApp = async () => {
  try {
    const items = await setup.askQuestions();
    const { version, code, email } = items;

    if (version !== 'mcdonalds') {
      console.log(chalk.red('The version of this script has not yet been written'));
      return;
    }

    const website = websites[version];
    if (!website) {
      console.log(chalk.red(`No website configured for version: ${version}`));
      return;
    }

    const status = new cli.Spinner('Starting Process...');
    status.start();

    // Validate receipt code format
    const [cn1, cn2, cn3] = (code || '').split('-');
    if (!cn1 || !cn2 || !cn3) {
      throw new Error('Invalid Receipt Code Provided. Expected format like ABC-123-456.');
    }

    // Add headers to mimic browser
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    };

    status.message('Getting entry point...');
    let res = await request.get(website, { headers: defaultHeaders });

    let html = parser.parse(res);
    const entryForm = html.querySelector('#surveyEntryForm');
    if (!entryForm) {
      console.log(chalk.red('Failed to find the #surveyEntryForm element. Website structure may have changed or request blocked.'));
      console.log(chalk.gray('Full HTML:'));
      console.log(html.toString().slice(0, 1000)); // print first 1000 chars only to avoid overload
      status.stop();
      return;
    }

    const entryAction = entryForm.getAttribute('action');
    if (!entryAction) {
      throw new Error('Failed to get the action attribute from #surveyEntryForm.');
    }

    const entryPoint = entryAction.replace('Index.aspx?', '');

    await sleep(500);

    status.message('Making first request...');
    res = await request.post(`${website}/Index.aspx?${entryPoint}`, {
      JavascriptEnabled: '1',
      FIP: 'True',
      P: '1',
      NextButton: 'Continue'
    }, { headers: defaultHeaders });

    await sleep(500);

    status.message('Making second request...');
    res = await request.post(`${website}/Index.aspx?${entryPoint}`, {
      JavascriptEnabled: '1',
      FIP: 'True',
      P: '2',
      Receipt: '1',
      NextButton: 'Next'
    }, { headers: defaultHeaders });

    await sleep(500);

    status.message('Submitting receipt data...');
    res = await request.post(`${website}/Survey.aspx?${entryPoint}`, {
      JavascriptEnabled: '1',
      FIP: 'True',
      CN1: cn1,
      CN2: cn2,
      CN3: cn3,
      Pound: '1',
      Pence: '99',
      NextButton: 'Start'
    }, { headers: defaultHeaders });

    html = parser.parse(res);

    if (html.querySelector('#BlockPage') || html.querySelector('.Error')) {
      throw new Error('The code you tried to enter has expired or is invalid.');
    }

    // Loop through questions
    let questionNum = 1;
    let finished = false;

    do {
      status.message(`Answering question ${questionNum}`);

      html = parser.parse(res);

      // Defensive checks for required hidden inputs
      const IoNFEl = html.querySelector('#IoNF');
      const PostedFNSEl = html.querySelector('#PostedFNS');

      if (!IoNFEl || !PostedFNSEl) {
        throw new Error('Missing required form tokens (IoNF or PostedFNS). Website may have changed.');
      }

      const IoNF = IoNFEl.getAttribute('value');
      const PostedFNS = PostedFNSEl.getAttribute('value');

      // Collect unique question names from input elements
      const questions = [...new Set(
        [...html.querySelectorAll('input[type=checkbox], input[type=radio], input[type=text], textarea')]
          .map(i => i.getAttribute('name'))
          .filter(Boolean)
      )];

      const dataBuilder = {
        IoNF,
        PostedFNS
      };

      questions.forEach(question => {
        if (questionAnswers[version][question] !== undefined) {
          let answer = questionAnswers[version][question];
          if (answer === '%%email%%') answer = email;
          dataBuilder[question] = answer;
        } else if (question.startsWith('R')) {
          dataBuilder[question] = 5;  // default rating for unknown questions starting with R
        } else {
          dataBuilder[question] = '';
        }
      });

      res = await request.post(`${website}/Survey.aspx?${entryPoint}`, dataBuilder, { headers: defaultHeaders });

      // If IoNF == '311' (magic number?), survey is finished
      if (IoNF === '311') {
        finished = true;
        break;
      }

      questionNum++;
      await sleep(250);

    } while (questionNum < 25 && !finished);

    if (!finished) {
      throw new Error('Timed out attempting to complete the survey.');
    }

    status.stop();
    console.log(chalk.green(`Code generated and emailed to ${email}.`));

  } catch (err) {
    console.log(chalk.red(`Error: ${err.message}`));
  }
};

runApp();
