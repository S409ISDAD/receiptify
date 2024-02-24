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

const sleep = async (duration) => {
  return new Promise(resolve => setTimeout(resolve, duration));
};

const runApp = async () => {
  const items = await setup.askQuestions();
  const { version, code, email } = items;

  if (version !== 'mcdonalds') {
    return console.log(chalk.red('The version of this script has not yet been written'));
  }

  const website = websites[version];
  const status = new cli.Spinner('Starting Process...');
  status.start();

  try {
    const [cn1, cn2, cn3] = code.split('-');
    if (!cn2 || !cn3) {
      throw new Error('Invalid Receipt Code Provided');
    }

    const res = await request.get(website);
    const html = parser.parse(res);
    const surveyEntryForm = html.querySelector('#surveyEntryForm');

    let entryPoint = surveyEntryForm.getAttribute('action') || '';
    entryPoint = entryPoint.replace('Index.aspx?', '');

    await sleep(500);

    const firstRequestData = {
      JavascriptEnabled: '1',
      FIP: 'True',
      P: '1',
      NextButton: 'Continue'
    };

    const firstRequestResponse = await request.post(`${website}/Index.aspx?${entryPoint}`, firstRequestData);

    await sleep(500);

    const secondRequestData = {
      JavascriptEnabled: '1',
      FIP: 'True',
      P: '2',
      Receipt: '1',
      NextButton: 'Next'
    };

    const secondRequestResponse = await request.post(`${website}/Index.aspx?${entryPoint}`, secondRequestData);

    await sleep(500);

    const submitData = {
      JavascriptEnabled: '1',
      FIP: 'True',
      CN1: cn1,
      CN2: cn2,
      CN3: cn3,
      Pound: '1',
      Pence: '99',
      NextButton: 'Start'
    };

    const submitResponse = await request.post(`${website}/Survey.aspx?${entryPoint}`, submitData);
    const submitHtml = parser.parse(submitResponse);

    if (submitHtml.querySelector('#BlockPage') || submitHtml.querySelector('.Error')) {
      throw new Error('The code you tried to enter has expired.');
    }

    let questionNum = 1;
    let finished = false;

    do {
      const IoNF = submitHtml.querySelector('#IoNF').getAttribute('value');
      const PostedFNS = submitHtml.querySelector('#PostedFNS').getAttribute('value');

      const questions = [...new Set([...submitHtml.querySelectorAll('[type=checkbox],[type=radio],[type=text],textarea')].map(i => i.getAttribute('name')))];
      const dataBuilder = { IoNF, PostedFNS };

      questions.forEach(question => {
        if (questionAnswers[version][question]) {
          const answer = questionAnswers[version][question] === '%%email%%' ? email : questionAnswers[version][question];
          dataBuilder[question] = answer;
        } else if (question.substr(0, 1) === 'R') {
          dataBuilder[question] = 5;
        } else {
          dataBuilder[question] = '';
        }
      });

      const answerResponse = await request.post(`${website}/Survey.aspx?${entryPoint}`, dataBuilder);

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
