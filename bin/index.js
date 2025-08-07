#!/usr/bin/env node

const setup = require("./lib/setup");
const request = require('./lib/request');

const cli = require('clui');
const parser = require('node-html-parser');
const chalk = require('chalk');
const puppeteer = require('puppeteer');

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
}

// helper function to sleep as to not make requests too quickly.
const sleep = async (duration) => new Promise(r => setTimeout(r, duration));

// Puppeteer function to get the form action after JS renders the page
async function getEntryPoint(website) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(website, { waitUntil: 'networkidle2' });

    // Wait for the form to appear or timeout after 10 seconds
    await page.waitForSelector('#surveyEntryForm', { timeout: 10000 });

    // Extract the form's action attribute
    const entryPoint = await page.$eval('#surveyEntryForm', form => form.getAttribute('action'));
    await browser.close();

    if (!entryPoint) {
      throw new Error('Form action not found');
    }
    return entryPoint.replace('Index.aspx?', '');
  } catch (e) {
    await browser.close();
    throw e;
  }
}

const runApp = async () => {
  const items = await setup.askQuestions();
  let { version, code, email } = items;

  if (version !== 'mcdonalds') {
    return console.log(chalk.red('The version of this script has not yet been written'));
  }

  const website = websites[version];
  const status = new cli.Spinner('Starting Process...');
  status.start();

  try {
    const [ cn1, cn2, cn3 ] = code.split('-');
    if (!cn2 || !cn3) {
      throw new Error('Invalid Receipt Code Provided');
    }

    status.message('Getting entry point...');
    const entryPoint = await getEntryPoint(website);

    await sleep(500);

    status.message('Making first request...');
    let res = await request.post(`${website}/Index.aspx?${entryPoint}`, {
      JavascriptEnabled: '1',
      FIP: 'True',
      P: '1',
      NextButton: 'Continue'
    });

    await sleep(500);

    status.message('Making second request...');
    res = await request.post(`${website}/Index.aspx?${entryPoint}`, {
      JavascriptEnabled: '1',
      FIP: 'True',
      P: '2',
      Receipt: '1',
      NextButton: 'Next'
    });

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
    });
    let html = parser.parse(res);

    if (html.querySelector('#BlockPage') || html.querySelector('.Error')) {
      throw new Error('The code you tried to enter has expired.');
    }

    let questionNum = 1;
    let finished = false;

    do {
      status.message(`Answering question ${questionNum}`);
      html = parser.parse(res);

      const IoNF = html.querySelector('#IoNF').getAttribute('value');
      const PostedFNS = html.querySelector('#PostedFNS').getAttribute('value');
      let questions = [...new Set([...html.querySelectorAll('[type=checkbox],[type=radio],[type=text],textarea')].map(i => i.getAttribute('name')))];

      const dataBuilder = { IoNF, PostedFNS };

      questions.forEach(question => {
        if (questionAnswers[version][question]) {
          const answer = questionAnswers[version][question] === '%%email%%' ? email : questionAnswers[version][question];
          dataBuilder[question] = answer;
        } else if (question.startsWith('R')) {
          dataBuilder[question] = 5;
        } else {
          dataBuilder[question] = '';
        }
      });

      res = await request.post(`${website}/Survey.aspx?${entryPoint}`, dataBuilder);

      if (IoNF === '311') {
        finished = true;
        break;
      }

      questionNum++;
      await sleep(250);

    } while (questionNum < 25 && !finished);

    if (!finished) {
      throw new Error('Timed out attempting to get code.');
    }

    status.stop();
    console.log(chalk.green(`Code generated and emailed to ${email}.`));

  } catch (err) {
    status.stop();
    console.log(chalk.red(err.message));
  }
};

runApp();
