(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/* global module, require */
var Promise = require('es6-promise').Promise;

/**
  * Promise-based AJAX API wrapping jQuery
  * Based on: https://gist.github.com/tobiashm/0a987db2f9ec8e5cdbb3
  */
module.exports = function AjaxApi(jqAjax) {
    /** Fetch any URL, expect JSON back */
    this.getJson = function (url) {
        return this.ajax({
            type: 'GET',
            url: url
        }).then(function (data) {
            if (typeof(data) !== 'object') {
                throw new Error('tutorweb::error::Got a ' + typeof(data) + ', not object whilst fetching ' + url);
            }
            return data;
        });
    };

    /** Post data, encoded as JSON, to url */
    this.postJson = function (url, data) {
        return this.ajax({
            data: JSON.stringify(data),
            contentType: 'application/json',
            type: 'POST',
            url: url
        });
    };

    /** Call $.ajax with given arguments, return promise-wrapped output */
    this.ajax = function (args) {
        return new Promise(function(resolve, reject) {
            jqAjax(args).then(function(data) {
                resolve(data);
            }).fail(function(jqXHR, textStatus, errorThrown) {
                if (jqXHR.responseJSON && jqXHR.responseJSON.error == 'Redirect') {
                    // Redirect error
                    reject(Error('Tutorweb::error::You have not accepted the terms and conditions. Please ' +
                                         '<a href="' + jqXHR.responseJSON.location + '" target="_blank">Click here and click the accept button</a>. ' +
                                         'Reload this page when finished'));
                }

                if (jqXHR.status === 401 || jqXHR.status === 403) {
                    reject(Error("tutorweb::error::Unauthorized to fetch " + args.url));
                }

                reject(Error("tutorweb::error::" + textStatus + " whilst fetching " + args.url + " " + errorThrown));
            });
        });
    };
};

},{"es6-promise":10}],2:[function(require,module,exports){
/*jslint nomen: true, plusplus: true, browser:true*/
/* global module */
module.exports = function IAA() {
    "use strict";

    /**
      * Pick a new question from the current lecture by generating a new
      * answerQueue entry
      *
      * answerQueue represents the questions assigned to a user and their answers.
      * When a student requests a new question, this will be called to generate
      * the next answerQueue member. Once they choose an answer, it will be
      * annotated with the answer they chose.
      *
      * cutTutorial - The data structure for the current tutorial
      * lecIndex - The index of the lecture the student is currently taking
      * answerQueue - Previous student answers, most recent last
      * practiceMode - True if student has engaged practice mode
      */
    this.newAllocation = function (curTutorial, lecIndex, answerQueue, practiceMode) {
        var questions, oldGrade, qn,
            settings = curTutorial.lectures[lecIndex].settings || {"hist_sel": curTutorial.lectures[lecIndex].hist_sel};
        if (Math.random() < parseFloat(settings.hist_sel || 0)) {
            questions = curTutorial.lectures[Math.floor(Math.random() * (lecIndex + 1))].questions;
        } else {
            questions = curTutorial.lectures[lecIndex].questions;
        }
        if (!questions || !questions.length) {
            return null;
        }

        if (answerQueue.length === 0) {
            oldGrade = 0;
        } else {
            oldGrade = answerQueue[answerQueue.length - 1].grade_after || 0;
        }

        qn = this.chooseQuestion(this.questionDistribution(
            questions.filter(function (qn) { return qn._type !== 'template'; }),
            oldGrade,
            answerQueue,
            questions.filter(function (qn) { return qn._type === 'template'; }),
            practiceMode ? 0 : getSetting(settings, "prob_template", 0.1) // No template questions in practice mode
        ));
        return {
            "uri": qn.uri,
            "allotted_time": this.qnTimeout(settings, qn._type === 'template' ? 0 : oldGrade),
            "grade_before": oldGrade,
            "practice": practiceMode
        };
    };

    /**
      * Grade the student's work, add it to the last item in the queue.
      * answerQueue: Previous student answers, most recent last
      */
    this.gradeAllocation = function (settings, answerQueue) {
        var self = this, aq, last;

        // Apply weighting to answerQueue
        function grade(aq) {
            var a, i, weighting, total = 0;

            weighting = self.gradeWeighting(
                aq.length,
                getSetting(settings, 'grade_alpha', 0.125),
                getSetting(settings, 'grade_s', 2));

            for (i = 0; i < weighting.length; i++) {
                a = aq[aq.length - i - 1];
                if (a && a.hasOwnProperty('correct')) {
                    total += weighting[i] * (a.correct ? 1 : -0.5);
                }
            }

            // Return grade 0..10, rounded to nearest .25
            return Math.max(Math.round(total * 40) / 4, 0);
        }

        // Only grade if all questions have been answered
        if (answerQueue.length === 0) return;
        last = answerQueue[answerQueue.length - 1];

        // Filter unanswered / practice questions
        aq = answerQueue.filter(function (a) {
            return a && !a.practice && a.hasOwnProperty('correct');
        });
        last.grade_next_right = grade(aq.concat({"correct" : true}));
        if (last.hasOwnProperty('correct')) {
            last.grade_after = grade(aq);
        } else {
            last.grade_before = grade(aq);
        }
    };

    /**
      * Generate weighting for (answers)
      *     n: Number of answers available
      *     alpha: Randomly assigned [0.15,0.30]
      *     s: Constant determining curve [1,4]
      *
      * Returns array of weightings according to:
      *     mmax=min(30, max(n, 8))
      *     w(1)=alpha
      *     w(2:nmax)=(1-alpha)*(1-(t-1)/(nmax+1))^s/(sum((1-(t-1)/(nmax+1))^s))
      *       ... but if w(2)>alpha use:
      *     w(1:nmax) = (1-t/(nmax+1))^s/(sum((1-t/(nmax+1))^s))
      */
    this.gradeWeighting = function (n, alpha, s) {
        var i, t,
            weightings = [],
            total = 0,
            nmax = Math.min(30, Math.max(n, 8)) + 1; //NB: One greater than formulae

        // Generate curve from 1..nmax
        for (t = 1; t < nmax; t++) {
            weightings.push(Math.pow(1 - t/nmax, s));
            total += weightings[weightings.length - 1];
        }

        if ((alpha / (1 - alpha)) < (weightings[0] / total)) {
            // Ignore curve and weight evenly
            for (i = 0; i < weightings.length; i++) {
                weightings[i] = 1 / (nmax - 1);
            }
        } else {
            // Add alpha to beginning
            total -= weightings.pop();
            weightings.unshift(alpha);

            // Scale rest of weightings, keeping alpha as-is
            total = total / (1 - alpha);
            for (i = 1; i < weightings.length; i++) {
                weightings[i] = weightings[i] / total;
            }
        }
        return weightings;
    };

    /** Given user's current grade, return how long they should have to do the next question in seconds */
    this.qnTimeout = function(settings, grade) {
        var tMax = getSetting(settings, 'timeout_max', 10) * 60, // Parameter in mins, tMax in secs
            tMin = getSetting(settings, 'timeout_min', 3) * 60, // Parameter in mins, tMin in secs
            gStar = getSetting(settings, 'timeout_grade', 5),
            s = getSetting(settings, 'timeout_std', 2);

        return tMax - Math.floor(
            (tMax - tMin) * Math.exp(-Math.pow(grade - gStar, 2) / (2 * Math.pow(s, 2))));
    };

    /** If str is in settings hash and parsable as a float, return that.
      * Otherwise, return defValue
      */
    function getSetting(settings, str, defValue) {
        if (isNaN(parseFloat(settings[str]))) {
            return defValue;
        }
        return parseFloat(settings[str]);
    }

    /** Choose a random question from qnDistribution, based on the probability
      * within.
      *
      * Returns that question
      */
    this.chooseQuestion = function (qnDistribution) {
        // Choose an item from qnDistribution once the cumulative probability
        // is greater than target
        var i = -1, total = 0, target = Math.random();
        while (total < target && i < qnDistribution.length - 1) {
            i++;
            total += qnDistribution[i].probability;
        }
        return qnDistribution[i].qn;
    };

    /** Return a PDF likelyhood of a question being chosen, given:-
      * questions: An array of objects, containing:-
      *     chosen: Number of times question has been answered
      *     correct: Of those times, how many a student gave a correct answer
      * answerQueue: Array of answers, newest first.
      * grade: Student's current grade, as calculated by gradeAllocation()
      *
      * Returns an array of questions, probability and difficulty.
      */
    this.questionDistribution = function(questions, grade, answerQueue, extras, extras_prob) {
        var i, difficulty,
            questionBias = {},
            total = 0;

        // difficulty: Array of { qn: question, difficulty: 0..1 }, sorted by difficulty
        difficulty = questions.map(function (qn) {
            // Significant numer of answers, so place normally
            if(qn.chosen > 5) return {"qn": qn, "difficulty": 1.0- (qn.correct/qn.chosen)};

            // Mark new questions as easy / hard, so they are likely to get them regardless.
            if(grade < 1.5) return {"qn": qn, "difficulty": (((qn.chosen-qn.correct)/2.0) + Math.random())/100.0};
            return {"qn": qn, "difficulty": 1.0 -(((qn.chosen-qn.correct)/2.0) + Math.random())/100.0};
        });
        difficulty = difficulty.sort(function (a, b) { return a.difficulty - b.difficulty; });

        // Bias questions based on previous answers (NB: Most recent answers will overwrite older)
        for (i = Math.max(answerQueue.length - 21, 0); i < answerQueue.length; i++) {
            if (!answerQueue[i].hasOwnProperty('correct')) continue;

            // If question incorrect, probablity increases with time. Correct questions less likely
            questionBias[answerQueue[i].uri] = answerQueue[i].correct ? 0.5 :
                                               Math.pow(1.05, answerQueue.length - i - 3);
        }

        // Generate a PDF based on grade, map questions to it ordered by difficulty
        ia_pdf(difficulty.length, grade, difficulty.length / 10.0).map(function (prob, i) {
            // As we go, apply question bias and generate a total so we can rescale to 1.
            difficulty[i].questionBias = (questionBias[difficulty[i].qn.uri] || 1);
            total += difficulty[i].probability = prob * difficulty[i].questionBias;
        });

        // If there are extras to insert, do this now
        if (extras && extras.length > 0 && extras_prob > 0) {
            // Scale probability to fit
            total = total / (1.0 - extras_prob);

            // Put end on end, dividing probability equally
            [].push.apply(difficulty, extras.map(function (qn) {
                return { "qn": qn, "probability": extras_prob / extras.length * total };
            }));
        }

        // Re-order based on probability, rescale to 1
        difficulty = difficulty.sort(function (a, b) { return a.probability - b.probability; });
        difficulty.map(function (d) {
            d.probability = d.probability / total;
        });

        return difficulty;

        //Use: pdf = ia_pdf(index, grade, q)
        //Before: index and grade are integers and 0<q<1
        //index specifies how many questions there are in the current exersize
        //grade is the users current grade (currently on the scale of -0.5 - 1
        //After: pdf is an array with the probability density distribution of the current 
        //exersize
        //Noktun pdf = ia_pdf(index , grade, q)
        //Fyrir: index og grade eru heiltölur, index
        //er hversu margar spurningar eru í heildina fyrir þann glærupakka, q er
        //tölfræði stuðull
        //0<q<1 grade er einkun fyrir þann glærupakka
        //Eftir: pdf er fylki með þettleika dreifingar fyrir hverja spurningu
        function ia_pdf(index, grade, q)
        {
            var i;
            grade = grade / 10;                //einkannir frá 0:1
            var x = [];
            for(var h = 0; h< index; h++)
                x[h] = (h+1)/(index+1.0);
            var alpha = q*grade;
            var beta = q - alpha;
            var y = [];
            for(i=0; i<x.length;i++)
                y[i]=1-x[i];
            arrayPower(x, alpha);                        //pdf=(x^alpha)*(1-x)^beta
            arrayPower(y, beta);
            var pdf = arrayMultiply(x, y);
            var sum = 0.0;                        //sum er summan úr öllum stökum í pdf
            for(var j=0; j<x.length; j++)
                sum += pdf[j];
            arrayDividescalar(pdf, sum);
            return pdf;
        }
        
        function arrayMultiply(arrayx, arrayy)
        {
            var arrayz = [];
            for(var i = 0; i<arrayx.length; i++)
                arrayz[i] = arrayx[i] * arrayy[i];
            return arrayz;
        }
        
        function arrayPower(array, power)
        {
            for(var i = 0; i< array.length; i++)
                array[i] = Math.pow(array[i], power);
            return array;
        }
        
        function arrayDividescalar(array, scalar)
        {
            for(var i = 0; i<array.length; i++)
                array[i] = array[i]/scalar;
            return array;
        }
    };
};

},{}],3:[function(require,module,exports){
/*jslint nomen: true, plusplus: true, browser:true*/
/* global require, jQuery, window */
var Quiz = require('./quizlib.js');

(function (window, $) {
    "use strict";
    var quiz, qs, handleError, updateState,
        jqQuiz = $('#tw-quiz'),
        jqBar = $('#load-bar');
    // Do nothing if not on the right page
    if ($('body.quiz-load').length === 0) { return; }

    /** Call an array of Ajax calls, splicing in extra options, onProgress called on each success, onDone at end */
    function callAjax(calls, extra, onProgress, onDone) {
        var dfds = calls.map(function (a) {
            return $.ajax($.extend({}, a, extra));
        });
        if (dfds.length === 0) {
            onDone();
        } else {
            dfds.map(function (d) { d.done(onProgress); });
            $.when.apply(null, dfds).done(onDone);
        }
    }

    updateState = function (curState, message, encoding) {
        var jqAlert;
        // Add message to page if we need to
        if (message) {
            jqAlert = $('<div class="alert">').addClass(curState === 'error' ? ' alert-error' : 'alert-info');
            if (encoding === 'html') {
                jqAlert.html(message);
            } else {
                jqAlert.text(message);
            }
            jqQuiz.children('div.alert').remove();
            jqQuiz.prepend(jqAlert);
        }

        if (curState === 'ready') {
            $('#tw-proceed').addClass("ready");
        }
    };

    function updateProgress(cur, max) {
        if (max === 0) {
            jqBar.css({"width": '0%'});
        } else if (cur < max) {
            jqBar.css({"width": (cur / max) * 100 + '%'});
        } else {
            jqBar.css({"width": '100%'});
        }
    }

    handleError = function (message, textStatus, errorThrown) {
        if (arguments.length === 3 && arguments[0].responseJSON &&
                                      arguments[0].responseJSON.error == 'Redirect') {
            // Redirect error
            updateState('error', 'You have not accepted the terms and conditions. Please ' +
                                 '<a href="'+arguments[0].responseJSON.location+'" target="_blank">Click here and click the accept button</a>. ' +
                                 'Reload this page when finished', 'html');
        } else if (arguments.length === 3) {
            // var jqXHR = message
            updateState('error', errorThrown + " (whilst requesting " + this.url + ")");
        } else {
            // Just a string
            updateState('error', message);
        }
    };

    // Catch any uncaught exceptions
    window.onerror = function (message, url, linenumber) {
        if (message.toLowerCase().indexOf('quota') > -1) {
            updateState("error", 'No more local storage available. Please <a href="start.html">return to the menu</a> and delete some tutorials you are no longer using.', 'html');
        } else {
            updateState("error", "Internal error: " +
                             message +
                             " (" + url + ":" + linenumber + ")");
        }
    };

    // Wire up quiz object
    quiz = new Quiz(localStorage);

    /** Download a tutorial given by URL */
    function downloadTutorial(url) {
        $.ajax({
            type: "GET",
            cache: false,
            url: url,
            error: handleError,
            success: function (data) {
                var i, ajaxCalls, count = 0;
                function noop() { }

                if (!quiz.insertTutorial(data.uri, data.title, data.lectures)) {
                    // Write failed, give up
                    return;
                }

                // Housekeep, remove all useless questions
                updateState("active", "Removing old questions...");
                quiz.removeUnusedObjects();

                // Get all the calls required to have a full set of questions
                updateState("active", "Downloading questions...");
                ajaxCalls = [];
                for (i = 0; i < data.lectures.length; i++) {
                    quiz.setCurrentLecture({ "tutUri": url, "lecUri": data.lectures[i].uri }, noop);  //TODO: Erg
                    //NB: Merge quiz.syncQuestions()'s array with ajaxCalls
                    Array.prototype.push.apply(ajaxCalls, quiz.syncQuestions());
                }

                // Do the calls, updating our progress bar
                callAjax(ajaxCalls, {error: handleError}, function () {
                    //TODO: Are we genuinely capturing full localStorage?
                    count += 1;
                    updateProgress(count, ajaxCalls.length);
                }, function () {
                    if (count < ajaxCalls.length) { return; }
                    updateProgress(1, 1);
                    updateState("ready", "Press the button to start your quiz");
                });
            },
        });
        updateState("active", "Downloading lectures...");
    }

    qs = quiz.parseQS(window.location);
    if (!qs.tutUri || !qs.lecUri) {
        handleError("Missing tutorial or lecture URI!");
        return;
    }
    if (qs.clear) {
        // Empty localStorage first
        window.localStorage.clear();
    }
    $('#tw-proceed').attr('href', quiz.quizUrl(qs.tutUri, qs.lecUri));
    downloadTutorial(qs.tutUri);
}(window, jQuery));

},{"./quizlib.js":5}],4:[function(require,module,exports){
/*jslint nomen: true, plusplus: true, browser:true*/
/* global require, jQuery */
var Quiz = require('./quizlib.js');
var View = require('./view.js');
var AjaxApi = require('./ajaxapi.js');

/**
  * View class to translate data into DOM structures
  *    $: jQuery
  *    jqQuiz: jQuery-wrapped <form id="tw-quiz">
  *    jqActions: <ul> that contains action buttons
  */
function QuizView($) {
    "use strict";
    this.jqTimer = $('#tw-timer');
    this.jqDebugMessage = $('#tw-debugmessage');
    this.jqGrade = $('#tw-grade');
    this.jqAnswered = $('#tw-answered');
    this.jqPractice = $('#tw-practice');
    this.timerTime = null;

    /** Start the timer counting down from startTime seconds */
    this.timerStart = function (onFinish, startTime) {
        var self = this;
        function formatTime(t) {
            var out = "";
            function plural(i, base) {
                return i + " " + base + (i !== 1 ? 's' : '');
            }

            if (t > 60) {
                out = plural(Math.floor(t / 60), 'min') + ' ';
                t = t % 60;
            }
            out += plural(t, 'sec');
            return out;
        }

        if (startTime) {
            self.timerTime = startTime;
        } else {
            if (this.timerTime === null) {
                // Something called timerStop, so stop.
                return;
            }
            self.timerTime = self.timerTime - 1;
        }

        if (self.timerTime > 0) {
            self.jqTimer.show();
            self.jqTimer.children('span').text(formatTime(self.timerTime));
            window.setTimeout(self.timerStart.bind(self, onFinish), 1000);
        } else {
            // Wasn't asked to stop, so it's a genuine timeout
            self.jqTimer.show();
            self.jqTimer.children('span').text("Out of time");
            onFinish();
        }
    };

    /** Stop the timer at it's current value */
    this.timerStop = function () {
        var self = this;
        self.timerTime = null;
    };

    /** Update the debug message with current URI and an extra string */
    this.updateDebugMessage = function (lecUri, qn) {
        var self = this;
        if (lecUri) { self.jqDebugMessage[0].lecUri = lecUri; }
        self.jqDebugMessage.text(self.jqDebugMessage[0].lecUri + "\n" + qn);
    };

   /** Update sync button, curState one of 'processing', 'online', 'offline', 'unauth', '' */
    this.syncState = function (curState) {
        var jqSync = $('#tw-sync');

        if (!curState) {
            // Want to know what the state is
            return jqSync[0].className === 'button active' ? 'processing'
                    : jqSync[0].className === 'button button-danger btn-unauth' ? 'unauth'
                    : jqSync[0].className === 'button button-success' ? 'online'
                         : 'unknown';
        }

        // Setting the state
        if (curState === 'processing') {
            jqSync[0].className = 'button active';
            jqSync.text("Syncing...");
        } else if (curState === 'online') {
            jqSync[0].className = 'button button-success';
            jqSync.text("Scores saved.");
        } else if (curState === 'offline') {
            jqSync[0].className = 'button button-info';
            jqSync.text("Currently offline. Sync once online");
        } else if (curState === 'unauth') {
            jqSync[0].className = 'button button-danger btn-unauth';
            jqSync.text("Click here to login, so your scores can be saved");
        } else if (curState === 'error') {
            jqSync[0].className = 'button button-danger';
            jqSync.text("Syncing failed!");
        } else {
            jqSync[0].className = 'button';
            jqSync.text("Sync answers");
        }
        return curState;
    };


    /** Render next question */
    this.renderNewQuestion = function (qn, a, onFinish) {
        var self = this, i, html = '';
        function el(name) {
            return $(document.createElement(name));
        }
        function previewTeX(jqEl) {
            var jqPreview = el('div').attr('class', 'tex-preview');
            function intelligentText(t) {
                return t.split("\n").map(function (line) { return el('p').text(line); });
            }

            jqPreview.empty().append(intelligentText(jqEl.val()));
            jqEl.change(function (e) {
                jqPreview.empty().append(intelligentText(e.target.value));
                self.renderMath();
            });
            return el('div').append([jqEl, jqPreview]);
        }

        self.updateDebugMessage(null, a.uri.replace(/.*\//, ''));
        if (qn._type === 'template') {
            self.jqQuiz.empty().append([
                el('h3').text(qn.title),
                el('p').html(qn.hints),
                previewTeX(el('textarea').attr('name', 'text').text(qn.example_text)),
                el('label').text("Write possible answers below. Check boxes for correct answers:"),
                el('table').attr('class', 'choices').append(qn.example_choices.map(function(text, i) {
                    return el('tr').append([
                        el('td').append(el('input').attr('type', 'checkbox')
                                     .attr('name', 'choice_' + i + '_correct')),
                        el('td').append(previewTeX(el('input').attr('type', 'text')
                                     .attr('name', 'choice_' + i)
                                     .attr('value', text)))
                    ]);
                })),
                el('label').text("Write an explanation below as to why it's a correct answer:"),
                previewTeX(el('textarea').attr('name', 'explanation').text(qn.example_explanation))
            ]);
        } else {
            self.jqQuiz.empty().append([
                (qn.text ? el('p').html(qn.text) : null),
                el('ol').attr('type', 'a').append(a.ordering.map(function(ord, i) {
                    return el('li').attr('id', 'answer_' + i).append([
                        el('label').attr('class', 'radio').html(qn.choices[ord]).prepend([
                            el('input').attr('type', 'radio').attr('name', 'answer').attr('value', i)
                        ])
                    ]);
                }))
            ]);
        }
        self.renderMath(onFinish);
    };

      /** Annotate with correct / incorrect selections */
    this.renderAnswer = function (a, answerData) {
        var self = this, i;
        self.jqQuiz.find('input,textarea').attr('disabled', 'disabled');

        if (a.question_type === 'template') {
            // No marking to do, just show a thankyou message
            answerData.explanation = answerData.explanation || (a.correct ?
                                     'Thankyou for submitting a question' :
                                     'Your question has not been saved');
        } else {
            self.jqQuiz.find('#answer_' + a.selected_answer).addClass('selected');
            // Mark all answers as correct / incorrect
            for (i = 0; i < a.ordering_correct.length; i++) {
                self.jqQuiz.find('#answer_' + i).addClass(a.ordering_correct[i] ? 'correct' : 'incorrect');
            }
        }

        if (a.hasOwnProperty('correct')) {
            self.jqQuiz.toggleClass('correct', a.correct);
            self.jqQuiz.toggleClass('incorrect', !a.correct);
        }

        if (answerData.explanation) {
            self.jqQuiz.append($('<div class="alert explanation">' + answerData.explanation + '</div>'));
            self.renderMath();
        } 
    };
    /** Helper to turn the last item in an answerQueue into a grade string */
    this.renderGrade = function (a) {
        var self = this, out = "", out_grade="";

        if (!a) {
            self.jqGrade.text(out);
            return;
        }

        if (a.practice) {
            out = "Practice mode";
            if (a.hasOwnProperty('practice_answered')) {
                out += ": " + a.practice_answered + " practice questions, " + a.practice_correct + " correct.";
            }
            self.jqPractice.text(out);
            self.jqAnswered.text("");
            self.jqGrade.text("");
            return;
        }

        if (a.hasOwnProperty('lec_answered') && a.hasOwnProperty('lec_correct')) {
       
            out += "\nAnswered " + (a.lec_answered - (a.practice_answered || 0)) + " questions, ";
            out += (a.lec_correct - (a.practice_correct || 0)) + " correctly.";
            self.jqAnswered.text(out);
        }
        if (a.hasOwnProperty('grade_after') || a.hasOwnProperty('grade_before')) {
        
            out_grade += "\nYour grade: ";
            out_grade += a.hasOwnProperty('grade_after') ? a.grade_after : a.grade_before;
            if (a.hasOwnProperty('grade_next_right')) {
                out_grade += ", if you get the next question right: " + a.grade_next_right;
            }
             self.jqGrade.text(out_grade);
        }
        self.jqPractice.text("");
       
    };

    /** Render previous answers in a list below */
    this.renderPrevAnswers = function (lastEight) {
        var self = this,
            jqList = $("#tw-previous-answers").find('ol');

        jqList.empty().append(lastEight.map(function (a) {
            var t = new Date(0);
            t.setUTCSeconds(a.answer_time);

            return $('<li/>')
                .addClass(a.correct ? 'correct' : 'incorrect')
                .attr('title',
                     (a.selected_answer ? 'You chose ' + String.fromCharCode(97 + a.selected_answer) + '\n' : '') +
                      'Answered ' + t.toLocaleDateString() + ' ' + t.toLocaleTimeString())
                .append($('<span/>').text(a.correct ? "✔" : '✗'));
        }));
    };

    this.renderStart = function (a, continuing, tutUri, tutTitle, lecUri, lecTitle) {
        var self = this;
        $("#tw-title").text(tutTitle + " - " + lecTitle);
        self.jqQuiz.empty().append($("<p/>").text(
            continuing ? "Click 'Continue question' to carry on" : "Click 'New question' to start"));
        self.updateDebugMessage(lecUri, '');
    };
}
QuizView.prototype = new View($);

(function (window, $, undefined) {
    "use strict";
    var quiz, twView;
    // Do nothing if not on the right page
    if ($('body.quiz-quiz').length === 0) { return; }

    // Wire up Quiz View
    twView = new QuizView($);
    window.onerror = twView.errorHandler();

    // Complain if there's no localstorage
    if (!window.localStorage) {
        throw "Sorry, we do not support your browser";
    }

    // Trigger reload if appCache needs it
    if (window.applicationCache) {
        window.applicationCache.addEventListener('updateready', function (e) {
            if (window.applicationCache.status !== window.applicationCache.UPDATEREADY) {
                return;
            }
            throw 'tutorweb::info::A new version is avaiable, click "Restart quiz"';
        });
    }

    // Create Quiz model
    quiz = new Quiz(localStorage, new AjaxApi($.ajax));

    /** Main state machine, perform actions and update what you can do next */
    twView.stateMachine(function updateState(curState, fallback) {
        $(document).data('tw-state', curState);
        twView.timerStop();

        switch (curState) {
        case 'initial':
            // Load the lecture referenced in URL, if successful hit the button to get first question.
            quiz.setCurrentLecture(quiz.parseQS(window.location), function (a, continuing) {
                twView.renderStart.apply(twView, arguments);
                twView.renderPrevAnswers(quiz.lastEight());
                twView.renderGrade(a);
                if (continuing == 'practice') {
                    updateState('quiz-practice');
                } else if (continuing == 'real') {
                    updateState('quiz-real');
                } else {
                    twView.updateActions(['gohome', 'quiz-practice', 'quiz-real']);
                    
                }
               
            });
            break;
        case 'quiz-real':
        case 'quiz-practice':
            twView.updateActions([]);
            quiz.getNewQuestion(curState.endsWith('-practice'), function (qn, a) {
                var actions;
                if (qn._type === 'template') {
                    actions = ['cs-skip', 'cs-submit'];
                } else if (curState.endsWith('-practice')) {
                    actions = ['mark-practice'];
                } else {
                    actions = ['mark-real'];
                }
                twView.renderNewQuestion.call(twView, qn, a, function () {
                    // Once MathJax is finished, start the timer
                    twView.timerStart(updateState.bind(null, actions[0]), a.remaining_time);
                });
                twView.renderGrade(a);
                twView.updateActions(actions);
                
            });
            break;
        case 'mark-real':
        case 'mark-practice':
        case 'cs-skip':
        case 'cs-submit':
            // Disable all controls and mark answer
            twView.updateActions([]);
            quiz.setQuestionAnswer(curState === 'cs-skip' ? [] : $('form#tw-quiz').serializeArray(), function (a) {
                twView.renderAnswer.apply(twView, arguments);
                twView.renderPrevAnswers(quiz.lastEight());
                twView.renderGrade(a);
                $('#tw-sync').trigger('click', 'noforce');
                 twView.updateActions(['gohome', 'quiz-practice', 'quiz-real']);
                 
                 });
            break;
        default:
            fallback(curState);
        }
    });

    $('#tw-sync').bind('click', function (event, noForce) {
        var syncCall;

        /** Call an array of Ajax calls, splicing in extra options, onProgress called on each success, onDone at end */
        function callAjax(calls, extra, onProgress, onDone) {
            var dfds = calls.map(function (a) {
                return $.ajax($.extend({}, a, extra));
            });
            if (dfds.length === 0) {
                onDone();
            } else {
                dfds.map(function (d) { d.done(onProgress); });
                $.when.apply(null, dfds).done(onDone);
            }
        }

        function onError(jqXHR, textStatus, errorThrown) {
            if (jqXHR.status === 401 || jqXHR.status === 403) {
                twView.syncState('unauth');
            } else {
                twView.syncState('error');
            }
        }

        if (twView.syncState() === 'processing') {
            // Don't want to repeatedly sync
            return;
        }
        if (twView.syncState() === 'unauth') {
            // Only show dialog if user has explcitly clicked button
            if (!noForce) {
                window.open(quiz.portalRootUrl(document.location) +
                            '/login?came_from=' +
                            encodeURIComponent(document.location.pathname.replace(/\/\w+\.html$/, '/close.html')),
                            "loginwindow");
                twView.syncState('default');
            }
            return;
        }
        twView.syncState('processing');
        if (!window.navigator.onLine) {
            twView.syncState('offline');
            return;
        }

        // Fetch AJAX call
        syncCall = quiz.syncLecture(!noForce);
        if (syncCall === null) {
            // Sync says there's nothing to do
            twView.syncState('default');
            return;
        }

        // Sync current lecture and it's questions
        callAjax([syncCall], {error: onError}, null, function () {
            callAjax(quiz.syncQuestions(), {error: onError}, null, function () {
                twView.syncState('online');
            });
        });
    });
    twView.syncState('default');
}(window, jQuery));
},{"./ajaxapi.js":1,"./quizlib.js":5,"./view.js":8}],5:[function(require,module,exports){
/*jslint nomen: true, plusplus: true, browser:true*/
/* global require, module, console */
var iaalib = new (require('./iaa.js'))();
var Promise = require('es6-promise').Promise;

/**
  * Main quiz object
  *  rawLocalStorage: Browser local storage object
  */
module.exports = function Quiz(rawLocalStorage, ajaxApi) {
    "use strict";
    this.tutorialUri = null;
    this.curTutorial = null;
    this.lecIndex = null;
    this.ajaxApi = ajaxApi;

    // Wrapper to let localstorage take JSON
    function JSONLocalStorage(backing) {
        this.backing = backing;

        this.removeItem = function (key) {
            return backing.removeItem(key);
        };

        this.getItem = function (key) {
            var value = backing.getItem(key);
            if (value === null) {
                return value;
            }
            return JSON.parse(value);
        };

        this.setItem = function (key, value) {
            backing.setItem(key, JSON.stringify(value));
            return true;
        };

        this.listItems = function () {
            var i, out = [];
            for (i = 0; i < backing.length; i++) {
                out.push(backing.key(i));
            }
            return out;
        };
    }
    this.ls = new JSONLocalStorage(rawLocalStorage);

    // Hack to get uncaught error to bubble up.
    function promiseFatalError(err) {
        setTimeout(function() {
            throw err;
        }, 0);
        throw err;
    }

    /** Remove tutorial from localStorage, including all lectures, return true iff successful */
    this.removeTutorial = function (tutUri) {
        var i, j, lectures, questions, twIndex, self = this;

        // Remove question objects associated with this tutorial
        lectures = self.ls.getItem(tutUri).lectures;
        for (i = 0; i < lectures.length; i++) {
            questions = lectures[i].questions;
            for (j = 0; j < lectures[i].questions.length; j++) {
                this.ls.removeItem(lectures[i].questions[j].uri);
            }
        }

        // Remove tutorial, and reference in index
        this.ls.removeItem(tutUri);
        twIndex = self.ls.getItem('_index');
        if (!twIndex) { return false; }
        delete twIndex[tutUri];
        return !!(self.ls.setItem('_index', twIndex));
    };

    /** Insert questions into localStorage */
    this.insertQuestions = function (qns, onSuccess) {
        var i, qnUris = Object.keys(qns);
        for (i = 0; i < qnUris.length; i++) {
            if (!this.ls.setItem(qnUris[i], qns[qnUris[i]])) { return; }
        }
        onSuccess();
    };

    /** Return deep array of lectures and their URIs */
    this.getAvailableLectures = function (onSuccess) {
        var self = this, k, t,
            tutorials = [],
            twIndex = self.ls.getItem('_index');

        function isSynced(lecture) {
            var i;
            for (i = 0; i < lecture.answerQueue.length; i++) {
                if (!lecture.answerQueue[i].synced) {
                    return false;
                }
            }
            return true;
        }
        function lecToObject(l) {
            return {
                "uri": self.quizUrl(k, l.uri),
                "title": l.title,
                "grade": self.gradeString(Array.last(l.answerQueue)),
                "synced": isSynced(l)
            };
        }
        /* jshint ignore:start */ // https://github.com/jshint/jshint/issues/1016
        for (k in twIndex)
        /* jshint ignore:end */ {
            if (twIndex.hasOwnProperty(k)) {
                t = self.ls.getItem(k);
                if (t && t.lectures) {
                    tutorials.push({
                        "uri": k,
                        "title": t.title,
                        "lectures": t.lectures.map(lecToObject),
                    });
                }
            }
        }
        //TODO: Sort tutorials?
        onSuccess(tutorials);
    };

    /** Set the current tutorial/lecture */
    this.setCurrentLecture = function (params, onSuccess) {
        var self = this, i, lecture, lastAns;
        if (!(params.tutUri && params.lecUri)) {
            throw "Missing lecture parameters: tutUri, params.lecUri";
        }

        // Find tutorial
        self.curTutorial = self.ls.getItem(params.tutUri);
        if (!self.curTutorial) {
            throw "Unknown tutorial: " + params.tutUri;
        }
        self.tutorialUri = params.tutUri;

        // Find lecture within tutorial
        for (i = 0; i < self.curTutorial.lectures.length; i++) {
            lecture = self.curTutorial.lectures[i];
            if (lecture.uri === params.lecUri) {
                lastAns = Array.last(lecture.answerQueue);
                self.lecIndex = i;
                iaalib.gradeAllocation(lecture.settings, self.curAnswerQueue());
                return onSuccess(
                    Array.last(lecture.answerQueue),
                    (lastAns && !lastAns.answer_time ? lastAns.practice ? 'practice' : 'real' : false),
                    params.tutUri,
                    self.curTutorial.title,
                    params.lecUri,
                    lecture.title
                );
            }
        }
        throw "Lecture " + params.lecUri + "not part of current tutorial";
    };

    /** Return the current lecture */
    this.getCurrentLecture = function () {
        var self = this;
        if (self.lecIndex === null) {
            throw "No lecture selected";
        }
        return self.curTutorial.lectures[self.lecIndex];
    };

    /** Return the answer queue for the current lecture */
    this.curAnswerQueue = function () {
        var self = this, curLecture = self.getCurrentLecture();
        if (!curLecture.answerQueue) {
            curLecture.answerQueue = [];
        }
        return curLecture.answerQueue;
    };

    /** Return last eight non-practice questions in reverse order */
    this.lastEight = function () {
        var self = this, i, a,
            answerQueue = self.curAnswerQueue(),
            out = [];

        for (i = answerQueue.length; i > 0; i--) {
            a = answerQueue[i - 1];
            if (a.answer_time && !a.practice) {
                out.push(a);
            }
            if (out.length >= 8) { return out; }
        }
        return out;
    };

    /** Choose a new question from the current tutorial/lecture */
    this.getNewQuestion = function (practiceMode, onSuccess) {
        var self = this, a, lastAns,
            answerQueue = self.curAnswerQueue();
        lastAns = Array.last(answerQueue);

        if (!lastAns || lastAns.answer_time) {
            // Assign new question if last has been answered
            a = iaalib.newAllocation(self.curTutorial, self.lecIndex, answerQueue, practiceMode);
            if (!a) {
                throw "Lecture has no questions!";
            }
            a.lec_answered = lastAns && lastAns.lec_answered ? lastAns.lec_answered : 0;
            a.lec_correct = lastAns && lastAns.lec_correct ? lastAns.lec_correct : 0;
            a.practice_answered = lastAns && lastAns.practice_answered ? lastAns.practice_answered : 0;
            a.practice_correct = lastAns && lastAns.practice_correct ? lastAns.practice_correct : 0;

            answerQueue.push(a);
        } else {
            // Get question data to go with last question on queue
            a = lastAns;
        }

        self._getQuestionData(a.uri).then(function (qn) {
            a.question_type = qn._type;
            if (qn._type === 'template') {
            } else {
                // Generate ordering, field value -> internal value
                a.ordering = a.ordering || Array.shuffle(qn.shuffle || []);
                while (a.ordering.length < qn.choices.length) {
                     // Pad out ordering with missing items on end
                    //NB: Assuming that you can't have fixed items anywhere else for now.
                    a.ordering.push(a.ordering.length);
                }
            }
            a.quiz_time = a.quiz_time || Math.round((new Date()).getTime() / 1000);
            a.synced = false;
            a.remaining_time = a.allotted_time;
            if (a.allotted_time && a.quiz_time) {
                a.remaining_time -= Math.round((new Date()).getTime() / 1000) - a.quiz_time;
            }
            if (self.ls.setItem(self.tutorialUri, self.curTutorial)) { onSuccess(qn, a); }
        })['catch'](promiseFatalError);
    };

    /** Returns a promise with the question data, either from localstorage or HTTP */
    this._getQuestionData = function (uri, cachedOkay) {
        var qn, promise, self = this;

        if (cachedOkay && self._lastFetched && self._lastFetched.uri === uri) {
            // Pull out of in-memory cache
            promise = Promise.resolve(self._lastFetched.question);
        } else {
            qn = self.ls.getItem(uri);
            if (qn) {
                // Fetch out of localStorage
                promise = Promise.resolve(qn);
            } else {
                // Fetch via. HTTP
                promise = self.ajaxApi.getJson(uri);
            }
        }

        // Store question for next time around
        // NB: This is here to ensure that answers get the same question data
        // as questions
        return promise.then(function (qn) {
            self._lastFetched = { "uri": uri, "question": qn };
            return qn;
        });
    };

    /** User has selected an answer */
    this.setQuestionAnswer = function (formData, onSuccess) {
        // Fetch question off answer queue, add answer
        var self = this,
            curLecture = self.getCurrentLecture(),
            a = Array.last(self.curAnswerQueue());
        a.answer_time = Math.round((new Date()).getTime() / 1000);
        a.form_data = formData;
        a.synced = false;

        // Question template
        if (a.question_type === 'template') {
            var parts;

            a.correct = false;
            a.student_answer = { "choices": [] };
            a.form_data.map(function (val) {
                var k = val.name, v = val.value;
                if (k === 'text') {
                    a.correct = v.length > 0;
                    a.student_answer.text = v;
                } else if (k === 'explanation') {
                    a.student_answer.explanation = v;
                } else if (k.match(/^choice_\d+/)) {
                    parts = k.split('_');
                    if (typeof(a.student_answer.choices[parts[1]]) === 'undefined') {
                        a.student_answer.choices[parts[1]] = { answer: "", correct: false };
                    }
                    if (parts.length == 2) {
                        a.student_answer.choices[parts[1]].answer = v;
                    } else if (parts[2] === "correct" && v) {
                        a.student_answer.choices[parts[1]].correct = true;
                    }
                } else {
                    throw new Error('Unknown form element ' + k);
                }
            });
            if (!a.correct) {
                a.student_answer = null;
            }

            iaalib.gradeAllocation(curLecture.settings, self.curAnswerQueue());
            a.lec_answered = (a.lec_answered || 0) + 1;

            // Update and return
            if (self.ls.setItem(self.tutorialUri, self.curTutorial)) {
                onSuccess(a, {});
            }

            return;
        }

        // It's a real question, get question data and mark
        self._getQuestionData(a.uri, true).then(function (qn) {
            var i,
                answerData = typeof qn.answer === 'string' ? JSON.parse(window.atob(qn.answer)) : qn.answer;

            // Find student answer in the form_data
            a.selected_answer = null;
            a.student_answer = null;
            for (i = 0; i < a.form_data.length; i++) {
                if (a.form_data[i].name === 'answer') {
                    a.selected_answer = a.form_data[i].value;
                    a.student_answer = a.ordering[a.selected_answer];
                    if (typeof a.student_answer === "undefined") {
                        a.student_answer = null;
                    }
                }
            }

            // Generate array showing which answers were correct
            a.ordering_correct = a.ordering.map(function (v) {
                return answerData.correct.indexOf(v) > -1;
            });
            // Student correct iff their answer is in list
            a.correct = answerData.correct.indexOf(a.student_answer) > -1;

            // Set appropriate grade
            iaalib.gradeAllocation(curLecture.settings, self.curAnswerQueue());
            a.lec_answered = (a.lec_answered || 0) + 1;
            a.lec_correct = (a.lec_correct || 0) + (a.correct ? 1 : 0);
            a.practice_answered = (a.practice_answered || 0) + (a.practice ? 1 : 0);
            a.practice_correct = (a.practice_correct || 0) + (a.practice && a.correct ? 1 : 0);

            // Update question with new counts
            for (i = 0; i < curLecture.questions.length; i++) {
                if (a.uri === curLecture.questions[i].uri) {
                    curLecture.questions[i].chosen += 1;
                    curLecture.questions[i].correct += a.correct ? 1 : 0;
                    break;
                }
            }

            if (self.ls.setItem(self.tutorialUri, self.curTutorial)) {
                onSuccess(a, answerData);
            }
        })['catch'](promiseFatalError);
    };

    /** Go through all tutorials/lectures, remove any lectures that don't have an owner */
    this.removeUnusedObjects = function () {
        var self = this, i, t, q, k, tutorial, lectures,
            lsContent = {},
            removedItems = [],
            lsList = self.ls.listItems(),
            twIndex = self.ls.getItem('_index');

        // Form object of everything in localStorage
        for (i = 0; i < lsList.length; i++) {
            lsContent[lsList[i]] = 0;
        }

        // Mark everything we find a reference to with 1
        lsContent._index = 1;
        for (t in twIndex) {
            if (twIndex.hasOwnProperty(t)) {
                tutorial = self.ls.getItem(t);
                if (!tutorial || !tutorial.lectures) { continue; }
                lsContent[t] = 1;
                lectures = tutorial.lectures;
                for (i = 0; i < lectures.length; i++) {
                    for (q in lectures[i].questions) {
                        if (lectures[i].questions.hasOwnProperty(q)) {
                            lsContent[lectures[i].questions[q].uri] = 1;
                        }
                    }
                }
            }
        }

        // If anything didn't get a reference, remove it
        for (k in lsContent) {
            if (lsContent.hasOwnProperty(k) && lsContent[k] === 0) {
                removedItems.push(k);
                self.ls.removeItem(k);
            }
        }
        return removedItems;
    };

    /** Insert tutorial into localStorage */
    this.insertTutorial = function (tutUri, tutTitle, lectures) {
        var self = this, i, twIndex,
            oldLectures = {};
        self.curTutorial = self.ls.getItem(tutUri);
        self.tutorialUri = tutUri;

        if (self.ls.getItem(tutUri)) {
            // Sort old lectures into a dict by URI
            for (i = 0; i < self.curTutorial.lectures.length; i++) {
                oldLectures[self.curTutorial.lectures[i].uri] = self.curTutorial.lectures[i];
            }
            // Tutorial already exists, update each lecture
            self.curTutorial.title = tutTitle;
            self.curTutorial.lectures = [];
            for (i = 0; i < lectures.length; i++) {
                if (oldLectures[lectures[i].uri]) {
                    self.curTutorial.lectures.push(oldLectures[lectures[i].uri]);
                    self.lecIndex = i;
                    self.updateLecture(lectures[i], 0);
                } else {
                    self.curTutorial.lectures.push(lectures[i]);
                }
            }
        } else {
            // Add whole tutorial to localStorage
            self.curTutorial = { "title": tutTitle, "lectures": lectures };
        }
        if (!self.ls.setItem(self.tutorialUri, self.curTutorial)) {
            return false;
        }

        // Update index with link to document
        twIndex = self.ls.getItem('_index') || {};
        twIndex[tutUri] = 1;
        return !!(self.ls.setItem('_index', twIndex));
    };

    /** Meld new lecture together with current */
    this.updateLecture = function (newLecture, syncingLength) {
        var self = this,
            curLecture = self.getCurrentLecture();

        // Check it's for the same user
        if (curLecture.user != newLecture.user) {
            throw "You are trying to download a lecture as a different user. Click 'Return to menu', Log out and try again.";
        }
        // Ensure any counts in answerQueue are consistent
        function updateCounts(extra, start) {
            var i, prevAnswer = start;
            if (start === null) {
                // No extra items to correct counts with (as in mock-tutorial)
                // so do nothing.
                return extra;
            }
            for (i = 0; i < extra.length; i++) {
                extra[i].lec_answered = (prevAnswer.lec_answered || 0) + (extra[i].answer_time ? 1 : 0);
                extra[i].lec_correct = (prevAnswer.lec_correct || 0) + (extra[i].correct ? 1 : 0);
                extra[i].practice_answered = (prevAnswer.practice_answered || 0) + (extra[i].practice && extra[i].answer_time ? 1 : 0);
                extra[i].practice_correct = (prevAnswer.practice_correct || 0) + (extra[i].practice && extra[i].correct ? 1 : 0);
                prevAnswer = extra[i];
            }
            return extra;
        }

        // Meld answerQueue from server with any new items.
        curLecture.answerQueue = newLecture.answerQueue.concat(
            updateCounts(curLecture.answerQueue.slice(syncingLength), Array.last(newLecture.answerQueue))
        );

        // Update local copy of lecture
        curLecture.title = newLecture.title;
        curLecture.settings = newLecture.settings;
        curLecture.questions = newLecture.questions;
        curLecture.removed_questions = newLecture.removed_questions;
        curLecture.slide_uri = newLecture.slide_uri;
        return self.ls.setItem(self.tutorialUri, self.curTutorial);
    };

    /** Generate AJAX call that will sync the current lecture */
    this.syncLecture = function (force) {
        var self = this, syncingLength, curLecture = self.getCurrentLecture();
        // Return true iff every answerQueue item has been synced
        function isSynced(lecture) {
            var i;
            for (i = 0; i < lecture.answerQueue.length; i++) {
                if (!lecture.answerQueue[i].synced) {
                    return false;
                }
            }
            return true;
        }
        if (!force && isSynced(curLecture)) {
            // Nothing to do, stop.
            return null;
        }

        // Note how long queue is now, so we don't loose questions in progress
        syncingLength = curLecture.answerQueue.length;
        while (syncingLength > 0 && !curLecture.answerQueue[syncingLength - 1].answer_time) {
            // Last item hasn't been answered yet, leave it alone
            syncingLength = syncingLength - 1;
        }

        // Generate AJAX call
        return {
            contentType: 'application/json',
            data: JSON.stringify(curLecture),
            url: curLecture.uri,
            type: 'POST',
            success: function (data) {
                self.updateLecture(data, syncingLength);
            },
        };
    };

    /** Generate array of AJAX calls, call them to have a complete set of questions */
    this.syncQuestions = function () {
        var self = this,
            missingQns = [],
            curLecture = self.getCurrentLecture();

        // Remove local copy of dead questions
        if (curLecture.removed_questions) {
            curLecture.removed_questions.map(function (qn) {
                self.ls.removeItem(qn);
            });
        }

        // Which questions are stale?
        missingQns = curLecture.questions.filter(function (qn) {
            //TODO: Should be checking question age too
            return ( !qn.online_only &&
                (self.ls.getItem(qn.uri) === null));
        });

        if (missingQns.length >= Math.min(10, curLecture.questions.length)) {
            // Most questions are missing, so just fetch everything
            return [{
                type: "GET",
                cache: false,
                url: curLecture.question_uri,
                success: function (data) {
                    self.insertQuestions(data, function () {});
                }
            }];
        }
        // Otherwise, fetch new questions
        return missingQns.map(function (qn) {
            // New question we don't have yet
            return {
                type: "GET",
                cache: false,
                url: qn.uri,
                success: function (data) {
                    var qns = {};
                    qns[qn.uri] = data;
                    self.insertQuestions(qns, function () {});
                },
            };
        });
    };

    /** Return an .ajax call that gets the slides */
    this.fetchSlides = function () {
        var self = this,
            curLecture = self.getCurrentLecture();

        if (!curLecture.slide_uri) {
            throw "tutorweb::error::No slides available!";
        }
        return {
            type: "GET",
            url: curLecture.slide_uri,
            datatype: 'html',
        };
    };

    /** Helper to turn the last item in an answerQueue into a grade string */
    this.gradeString = function (a) {
        var out = "";
        if (!a) { return ""; }
        if (a.practice) {
            out = "Practice mode";
            if (a.hasOwnProperty('practice_answered')) {
                out += ": " + a.practice_answered + " practice questions, " + a.practice_correct + " correct.";
            }
            return out;
        }
        if (a.hasOwnProperty('lec_answered') && a.hasOwnProperty('lec_correct')) {
            out += "\nAnswered " + (a.lec_answered - (a.practice_answered || 0)) + " questions, ";
            out += (a.lec_correct - (a.practice_correct || 0)) + " correctly.";
        }
        if (a.hasOwnProperty('grade_after') || a.hasOwnProperty('grade_before')) {
            out += "\nYour grade: ";
            out += a.hasOwnProperty('grade_after') ? a.grade_after : a.grade_before;
            if (a.hasOwnProperty('grade_next_right')) {
                out += ", if you get the next question right: " + a.grade_next_right;
            }
        }
        return out;
    };

    /** Helper to form a URL to a selected quiz */
    this.quizUrl = function (tutUri, lecUri) {
        return 'quiz.html?tutUri=' + encodeURIComponent(tutUri) + ';lecUri=' + encodeURIComponent(lecUri);
    };

    /**
      * Given URL object, chop querystring up into a key/value object
      * e.g. quiz.parseQS(window.location)
      */
    this.parseQS = function (url) {
        var i, part,
            out = {},
            qs = url.search.replace(/^\?/, '').split(/;|&/);
        for (i = 0; i < qs.length; i++) {
            part = qs[i].split('=');
            out[part[0]] = decodeURIComponent(part[1]);
        }
        return out;
    };

    /**
      * Based on location (e.g. document.location) Return what is probably the
      * Plone root
      */
    this.portalRootUrl = function (location) {
        return location.protocol + '//' + location.host + '/';
    };
};

},{"./iaa.js":2,"es6-promise":10}],6:[function(require,module,exports){
/*jslint nomen: true, plusplus: true, browser:true*/
/* global require, jQuery */
var Quiz = require('./quizlib.js');
var View = require('./view.js');

/**
  * View class to translate data into DOM structures
  *    $: jQuery
  *    jqQuiz: jQuery-wrapped <form id="tw-quiz">
  *    jqActions: <ul> that contains action buttons
  */
function SlideView($) {
    "use strict";
    this.renderSlide = function (url) {
        var self = this,
            request = new XMLHttpRequest();

        request.open('GET', url, true);
        request.onload = function() {
          if (request.status >= 200 && request.status < 400){
            self.jqQuiz.html(request.responseText);
            self.jqQuiz.removeClass('busy');
          } else {
            throw "tutorweb::error::" + request.status + " whilst requesting " + url;
          }
        };
        request.onerror = function(event) {
             throw "tutorweb::error::Could not fetch " + url;
        };
        request.send();
    };

    this.renderSlides = function (jqSlides) {
        var self = this;

        self.jqQuiz.find('.slide-collection').replaceWith(jqSlides);
        self.renderMath();
        self.jqQuiz.find('.slide-content figure').click(function (e) {
            $(this).toggleClass('show-code');
        });
    };

    this.selectSlide = function (slideId) {
        var self = this, jqPrevId, jqNextId,
            jqPrevButton = self.jqQuiz.find('#tw-slide-prev'),
            jqNextButton = self.jqQuiz.find('#tw-slide-next'),
            jqCollection = self.jqQuiz.find('.slide-collection').children();

        jqCollection.map(function (i, sl) {
            var jqNext, jqPrev, jqSl = $(sl);
            if ((slideId === "" && i === 0) || (slideId === jqSl.attr('id'))) {
                jqSl.addClass('selected');
                slideId = jqSl.attr('id');
                $("#tw-slide-title").text(jqSl.find('h2').text());

                jqPrevId = jqSl.prev().attr('id');
                jqPrevButton.attr('href', '#' + (jqPrevId || slideId));
                jqPrevButton.toggleClass('disabled', typeof jqPrevId == 'undefined');

                jqNextId = jqSl.next().attr('id');
                jqNextButton.attr('href', '#' + (jqNextId || slideId));
                jqNextButton.toggleClass('disabled', typeof jqNextId == 'undefined');
            } else {
                jqSl.removeClass('selected');
            }
        });
    };
}
SlideView.prototype = new View($);

(function (window, $, undefined) {
    "use strict";
    var quiz, twView;

    /** Call an array of Ajax calls, splicing in extra options, onProgress called on each success, onDone at end */
    function callAjax(calls, extra, onProgress, onDone) {
        var handleError = function (jqXHR, textStatus, errorThrown) {
            if (jqXHR.status === 401 || jqXHR.status === 403) {
                throw "tutorweb::error::Unauthorized to fetch " + this.url;
            } else {
                throw "tutorweb::error::Could not fetch " + this.url;
            }
        };

        var dfds = calls.map(function (a) {
            return $.ajax($.extend({error: handleError}, a, extra));
        });
        if (dfds.length === 0) {
            onDone();
        } else {
            dfds.map(function (d) { d.done(onProgress); });
            $.when.apply(null, dfds).done(onDone);
        }
    }

    // Do nothing if not on the right page
    if ($('body.page-slide').length === 0) { return; }

    // Wire up quiz object
    twView = new SlideView($);
    window.onerror = twView.errorHandler();

    // Create Quiz model
    quiz = new Quiz(localStorage);

    // Start state machine
    twView.stateMachine(function updateState(curState, fallback) {
        switch (curState) {
        case 'initial':
            this.updateActions(['gohome', 'go-drill']);
            quiz.setCurrentLecture(quiz.parseQS(window.location), function (continuing, tutUri, tutTitle, lecUri, lecTitle) {
                $("#tw-title").text(tutTitle + " - " + lecTitle);
                updateState('fetch-slides');
            });
            break;
        case 'fetch-slides':
            callAjax([quiz.fetchSlides()], {}, function () {}, function (docString) {
                var doc = $('<div/>').html(docString);
                twView.renderSlides(doc.find('.slide-collection'));
                twView.selectSlide(window.location.hash.replace(/^#!?/, ""));
            });
            break;
        default:
            fallback(curState);
        }
    });

    window.onhashchange = function () {
        twView.selectSlide(window.location.hash.replace(/^#!?/, ""));
    };
}(window, jQuery));

},{"./quizlib.js":5,"./view.js":8}],7:[function(require,module,exports){
/*jslint nomen: true, plusplus: true, browser:true*/
/* global require, jQuery */
var Quiz = require('./quizlib.js');

function StartView($, jqQuiz, jqSelect) {
    "use strict";
    this.jqQuiz = jqQuiz;
    this.jqSelect = jqSelect;

    /** Put an alert div at the top of the page */
    this.renderAlert = function (type, message) {
        var self = this;
        self.jqQuiz.children('div.alert').remove();
        self.jqQuiz.prepend($('<div class="alert">')
            .addClass("alert-" + type)
            .text(message));
    };

    /** Generate expanding list for tutorials / lectures */
    this.renderChooseLecture = function (items) {
        var self = this;
        self.jqSelect.empty();

        // Error message if there's no items
        if (!items.length) {
            self.renderAlert("info", 'You have no tutorials loaded yet. Please visit tutorweb by clicking "Get more tutorials", and choose a department and tutorial');
            return;
        }

        // [[href, title, items], [href, title, items], ...] => markup
        // items can also be {uri: '', title: ''}
        function listToMarkup(items) {
            var i, jqA, item, jqUl = $('<ul/>');
            if (typeof items === 'undefined') {
                return null;
            }
            for (i = 0; i < items.length; i++) {
                item = items[i];
                jqA = $('<a/>').attr('href', item.uri).text(item.title);
                if (item.grade) {
                    jqA.append($('<span class="grade"/>').text(item.grade));
                }
                jqUl.append($('<li/>')
                        .append(jqA)
                        .append(listToMarkup(item.lectures))
                        );
            }
            return jqUl;
        }

        // Recursively turn tutorials, lectures into a ul, populate existing ul.
        self.jqSelect.append(listToMarkup(items).children());

        // Open tutorial if it's the only one
        if (items.length === 1) {
            self.jqSelect.find("> li:first-child > a").trigger("click");
        }
    };
}

(function (window, $, undefined) {
    "use strict";
    var quiz, view,
        unsyncedLectures = [],
        jqQuiz = $('#tw-quiz'),
        jqLogout = $('#tw-logout'),
        jqSelect = $('#tw-select'),
        jqProceed = $('#tw-proceed'),
        jqSync = $('#tw-sync'),
        jqDelete = $('#tw-delete'),
        jqViewSlides = $('#tw-view-slides');

    // Do nothing if not on the right page
    if ($('body.quiz-start').length === 0) { return; }

    // Catch any uncaught exceptions
    window.onerror = function (message, url, linenumber) {
        view.renderAlert("error", "Internal error: " +
                                  message +
                                  " (" + url + ":" + linenumber + ")");
    };

    // Wire up quiz object
    view = new StartView($, jqQuiz, jqSelect);
    quiz = new Quiz(localStorage);

    // Refresh menu, both on startup and after munging quizzes
    function refreshMenu() {
        quiz.getAvailableLectures(function (tutorials) {
            view.renderChooseLecture(tutorials);

            // Get all lecture titles from unsynced lectures
            unsyncedLectures = [].concat.apply([], tutorials.map(function (t) {
                return (t.lectures.filter(function (l) { return !l.synced; })
                                  .map(function (l) { return l.title; }));
            }));
        });
    }

    // Point to root of current site
    document.getElementById('tw-home').href = quiz.portalRootUrl(document.location);

    // If button is disabled, do nothing
    $('#tw-actions > *').click(function (e) {
        if ($(this).hasClass("disabled")) {
            e.preventDefault();
            return false;
        }
    });

    // Logout should log out of Plone, but after asking first
    jqLogout.attr('href', quiz.portalRootUrl(document.location) + '/logout');
    jqLogout.click(function (e) {
        var unSyncedLecture = unsyncedLectures[0];

        if (unSyncedLecture && !window.confirm("Your answers to " + unSyncedLecture + " haven't been sent to the Tutor-Web server.\nIf you click okay some answers will be lost")) {
            e.preventDefault();
            return false;
        }

        localStorage.clear();
        return true;
    });

    // Sync all tutorials
    jqSync.click(function (e) {
        //TODO: Sync tutorials in turn
        e.preventDefault();
        return false;
    });

    // Remove selected tutorial
    jqDelete.click(function (e) {
        var self = this;
        if ($(this).hasClass("disabled")) {
            e.preventDefault();
            return false;
        }
        //TODO: Sync first
        quiz.removeTutorial($(self).data('tutUri'));
        refreshMenu();
        jqProceed.addClass("disabled");
        jqDelete.addClass("disabled");
    });

  // Click on the select box opens / closes items
    jqSelect.click(function (e) {
        var jqTarget = $(e.target);
        e.preventDefault();
        jqSelect.find(".selected").removeClass("selected");
        jqProceed.addClass("disabled");
        jqDelete.addClass("disabled");
        jqViewSlides.addClass("disabled");
        if (jqTarget.parent().parent()[0] === this) {
            // A 1st level tutorial, Just open/close item
            jqTarget.parent().toggleClass("expanded");
            if (jqTarget.parent().hasClass("expanded")) {
                jqDelete.data('tutUri', e.target.href);
                jqDelete.removeClass("disabled");
            }
        } else if (e.target.tagName === 'A' || e.target.tagName === 'SPAN') {
            if (e.target.tagName === 'SPAN') {
                jqTarget = jqTarget.parent('a');
            }
            // A quiz link, select it
            jqTarget.addClass("selected");
            jqProceed.removeClass("disabled");
            jqDelete.removeClass("disabled");
            jqProceed.attr('href', jqTarget.attr('href'));
            jqViewSlides.removeClass("disabled");
            jqViewSlides.attr('href', jqTarget.attr('href').replace(/quiz\.html/, 'slide.html'));
        }
    });

    refreshMenu();

}(window, jQuery));

},{"./quizlib.js":5}],8:[function(require,module,exports){
/* global module, MathJax, window */
/**
  * View class for all pages
  */
module.exports = function View($) {
    "use strict";
    this.jqQuiz = $('#tw-quiz');
    this.jqActions = $('#tw-actions');
    this.locale = {
        "reload": "Restart",
        "gohome": "Back to main menu",
        "go-drill": "Take a drill",
        "quiz-practice": "Practice question",
        "quiz-real": "New question",
        "mark-practice": "Submit answer >>>",
        "mark-real": "Submit answer >>>",
        "cs-skip": "Skip question writing",
        "cs-submit": "Submit your question",
        "" : ""
    };

    /** Regenerate button collection to contain given buttons */
    this.updateActions = function (actions) {
        var self = this;

        self.jqActions.empty().append(actions.reverse().map(function (a, i) {
            return $('<button/>')
                .attr('data-state', a)
                .attr('class', 'button')
                .text(self.locale[a] || a);
        }));
    };

    /** Tell MathJax to render anything on the page */
    this.renderMath = function (onSuccess) {
        var jqQuiz = this.jqQuiz;
        jqQuiz.addClass("busy");
        MathJax.Hub.Queue(["Typeset", MathJax.Hub, this.jqQuiz[0]]);
        MathJax.Hub.Queue(function () {
            jqQuiz.removeClass("busy");
        });
        if (onSuccess) {
            MathJax.Hub.Queue(onSuccess);
        }
    };

    /** Add a message to the page */
    this.showAlert = function (state, message, encoding) {
        var jqQuiz = this.jqQuiz,
            jqAlert = $('<div class="alert">').addClass(state === 'error' ? ' alert-error' : 'alert-info');

        if (encoding === 'html') {
            jqAlert.html(message);
        } else {
            jqAlert.text(message);
        }
        jqQuiz.children('div.alert').remove();
        jqQuiz.prepend(jqAlert);
    };

    /** Return an error handler to attach to window.onerror */
    this.errorHandler = function () {
        var self = this;
        return function (message, url, linenumber) {
            self.jqQuiz.removeClass('busy');
            if (message.toLowerCase().indexOf('quota') > -1) {
                self.showAlert("error", 'No more local storage available. Please <a href="start.html">return to the menu</a> and delete some tutorials you are no longer using.', 'html');
            } else if (message.indexOf('tutorweb::') !== -1) {
                self.showAlert.apply(self, message.split(/\:\:/).splice(1));
            } else {
                self.showAlert("error", "Internal error: " + message + " (" + url + ":" + linenumber + ")");
            }
            // The only action now should be to reload the page
            $('.tw-action').remove();
            self.updateActions(['gohome', 'reload']);
        };
    };

    /** Initalise and start a state machine to control the page */
    this.stateMachine = function (updateState) {
        var self = this;
        // State machine to use when nothing else works
        function fallback(curState) {
            switch (curState) {
            case 'processing':
                break;
            case 'request-reload':
                self.updateActions(['reload']);
                break;
            case 'reload':
                window.location.reload(false);
                break;
            case 'gohome':
                window.location.href = 'start.html';
                break;
            case 'go-drill':
                window.location.href = 'quiz.html' + window.location.search;
                break;
            default:
                throw "tutorweb::error::Unknown state '" + curState + "'";
            }
        }

        // Hitting the button moves on to the next state in the state machine
        $('#tw-actions, .tw-action').bind('click', function (event) {
            var newState = event.target.getAttribute('data-state');
            if (!newState) {
                return;
            }

            event.preventDefault();
            updateState.call(self, newState, fallback);
        });
        updateState.call(self, "initial", fallback);
    };
};

},{}],9:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],10:[function(require,module,exports){
"use strict";
var Promise = require("./promise/promise").Promise;
var polyfill = require("./promise/polyfill").polyfill;
exports.Promise = Promise;
exports.polyfill = polyfill;
},{"./promise/polyfill":14,"./promise/promise":15}],11:[function(require,module,exports){
"use strict";
/* global toString */

var isArray = require("./utils").isArray;
var isFunction = require("./utils").isFunction;

/**
  Returns a promise that is fulfilled when all the given promises have been
  fulfilled, or rejected if any of them become rejected. The return promise
  is fulfilled with an array that gives all the values in the order they were
  passed in the `promises` array argument.

  Example:

  ```javascript
  var promise1 = RSVP.resolve(1);
  var promise2 = RSVP.resolve(2);
  var promise3 = RSVP.resolve(3);
  var promises = [ promise1, promise2, promise3 ];

  RSVP.all(promises).then(function(array){
    // The array here would be [ 1, 2, 3 ];
  });
  ```

  If any of the `promises` given to `RSVP.all` are rejected, the first promise
  that is rejected will be given as an argument to the returned promises's
  rejection handler. For example:

  Example:

  ```javascript
  var promise1 = RSVP.resolve(1);
  var promise2 = RSVP.reject(new Error("2"));
  var promise3 = RSVP.reject(new Error("3"));
  var promises = [ promise1, promise2, promise3 ];

  RSVP.all(promises).then(function(array){
    // Code here never runs because there are rejected promises!
  }, function(error) {
    // error.message === "2"
  });
  ```

  @method all
  @for RSVP
  @param {Array} promises
  @param {String} label
  @return {Promise} promise that is fulfilled when all `promises` have been
  fulfilled, or rejected if any of them become rejected.
*/
function all(promises) {
  /*jshint validthis:true */
  var Promise = this;

  if (!isArray(promises)) {
    throw new TypeError('You must pass an array to all.');
  }

  return new Promise(function(resolve, reject) {
    var results = [], remaining = promises.length,
    promise;

    if (remaining === 0) {
      resolve([]);
    }

    function resolver(index) {
      return function(value) {
        resolveAll(index, value);
      };
    }

    function resolveAll(index, value) {
      results[index] = value;
      if (--remaining === 0) {
        resolve(results);
      }
    }

    for (var i = 0; i < promises.length; i++) {
      promise = promises[i];

      if (promise && isFunction(promise.then)) {
        promise.then(resolver(i), reject);
      } else {
        resolveAll(i, promise);
      }
    }
  });
}

exports.all = all;
},{"./utils":19}],12:[function(require,module,exports){
(function (process,global){
"use strict";
var browserGlobal = (typeof window !== 'undefined') ? window : {};
var BrowserMutationObserver = browserGlobal.MutationObserver || browserGlobal.WebKitMutationObserver;
var local = (typeof global !== 'undefined') ? global : (this === undefined? window:this);

// node
function useNextTick() {
  return function() {
    process.nextTick(flush);
  };
}

function useMutationObserver() {
  var iterations = 0;
  var observer = new BrowserMutationObserver(flush);
  var node = document.createTextNode('');
  observer.observe(node, { characterData: true });

  return function() {
    node.data = (iterations = ++iterations % 2);
  };
}

function useSetTimeout() {
  return function() {
    local.setTimeout(flush, 1);
  };
}

var queue = [];
function flush() {
  for (var i = 0; i < queue.length; i++) {
    var tuple = queue[i];
    var callback = tuple[0], arg = tuple[1];
    callback(arg);
  }
  queue = [];
}

var scheduleFlush;

// Decide what async method to use to triggering processing of queued callbacks:
if (typeof process !== 'undefined' && {}.toString.call(process) === '[object process]') {
  scheduleFlush = useNextTick();
} else if (BrowserMutationObserver) {
  scheduleFlush = useMutationObserver();
} else {
  scheduleFlush = useSetTimeout();
}

function asap(callback, arg) {
  var length = queue.push([callback, arg]);
  if (length === 1) {
    // If length is 1, that means that we need to schedule an async flush.
    // If additional callbacks are queued before the queue is flushed, they
    // will be processed by this flush that we are scheduling.
    scheduleFlush();
  }
}

exports.asap = asap;
}).call(this,require("/Users/magneavignisdottir/tutorweb.quiz/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"/Users/magneavignisdottir/tutorweb.quiz/node_modules/browserify/node_modules/insert-module-globals/node_modules/process/browser.js":9}],13:[function(require,module,exports){
"use strict";
var config = {
  instrument: false
};

function configure(name, value) {
  if (arguments.length === 2) {
    config[name] = value;
  } else {
    return config[name];
  }
}

exports.config = config;
exports.configure = configure;
},{}],14:[function(require,module,exports){
(function (global){
"use strict";
/*global self*/
var RSVPPromise = require("./promise").Promise;
var isFunction = require("./utils").isFunction;

function polyfill() {
  var local;

  if (typeof global !== 'undefined') {
    local = global;
  } else if (typeof window !== 'undefined' && window.document) {
    local = window;
  } else {
    local = self;
  }

  var es6PromiseSupport = 
    "Promise" in local &&
    // Some of these methods are missing from
    // Firefox/Chrome experimental implementations
    "resolve" in local.Promise &&
    "reject" in local.Promise &&
    "all" in local.Promise &&
    "race" in local.Promise &&
    // Older version of the spec had a resolver object
    // as the arg rather than a function
    (function() {
      var resolve;
      new local.Promise(function(r) { resolve = r; });
      return isFunction(resolve);
    }());

  if (!es6PromiseSupport) {
    local.Promise = RSVPPromise;
  }
}

exports.polyfill = polyfill;
}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./promise":15,"./utils":19}],15:[function(require,module,exports){
"use strict";
var config = require("./config").config;
var configure = require("./config").configure;
var objectOrFunction = require("./utils").objectOrFunction;
var isFunction = require("./utils").isFunction;
var now = require("./utils").now;
var all = require("./all").all;
var race = require("./race").race;
var staticResolve = require("./resolve").resolve;
var staticReject = require("./reject").reject;
var asap = require("./asap").asap;

var counter = 0;

config.async = asap; // default async is asap;

function Promise(resolver) {
  if (!isFunction(resolver)) {
    throw new TypeError('You must pass a resolver function as the first argument to the promise constructor');
  }

  if (!(this instanceof Promise)) {
    throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");
  }

  this._subscribers = [];

  invokeResolver(resolver, this);
}

function invokeResolver(resolver, promise) {
  function resolvePromise(value) {
    resolve(promise, value);
  }

  function rejectPromise(reason) {
    reject(promise, reason);
  }

  try {
    resolver(resolvePromise, rejectPromise);
  } catch(e) {
    rejectPromise(e);
  }
}

function invokeCallback(settled, promise, callback, detail) {
  var hasCallback = isFunction(callback),
      value, error, succeeded, failed;

  if (hasCallback) {
    try {
      value = callback(detail);
      succeeded = true;
    } catch(e) {
      failed = true;
      error = e;
    }
  } else {
    value = detail;
    succeeded = true;
  }

  if (handleThenable(promise, value)) {
    return;
  } else if (hasCallback && succeeded) {
    resolve(promise, value);
  } else if (failed) {
    reject(promise, error);
  } else if (settled === FULFILLED) {
    resolve(promise, value);
  } else if (settled === REJECTED) {
    reject(promise, value);
  }
}

var PENDING   = void 0;
var SEALED    = 0;
var FULFILLED = 1;
var REJECTED  = 2;

function subscribe(parent, child, onFulfillment, onRejection) {
  var subscribers = parent._subscribers;
  var length = subscribers.length;

  subscribers[length] = child;
  subscribers[length + FULFILLED] = onFulfillment;
  subscribers[length + REJECTED]  = onRejection;
}

function publish(promise, settled) {
  var child, callback, subscribers = promise._subscribers, detail = promise._detail;

  for (var i = 0; i < subscribers.length; i += 3) {
    child = subscribers[i];
    callback = subscribers[i + settled];

    invokeCallback(settled, child, callback, detail);
  }

  promise._subscribers = null;
}

Promise.prototype = {
  constructor: Promise,

  _state: undefined,
  _detail: undefined,
  _subscribers: undefined,

  then: function(onFulfillment, onRejection) {
    var promise = this;

    var thenPromise = new this.constructor(function() {});

    if (this._state) {
      var callbacks = arguments;
      config.async(function invokePromiseCallback() {
        invokeCallback(promise._state, thenPromise, callbacks[promise._state - 1], promise._detail);
      });
    } else {
      subscribe(this, thenPromise, onFulfillment, onRejection);
    }

    return thenPromise;
  },

  'catch': function(onRejection) {
    return this.then(null, onRejection);
  }
};

Promise.all = all;
Promise.race = race;
Promise.resolve = staticResolve;
Promise.reject = staticReject;

function handleThenable(promise, value) {
  var then = null,
  resolved;

  try {
    if (promise === value) {
      throw new TypeError("A promises callback cannot return that same promise.");
    }

    if (objectOrFunction(value)) {
      then = value.then;

      if (isFunction(then)) {
        then.call(value, function(val) {
          if (resolved) { return true; }
          resolved = true;

          if (value !== val) {
            resolve(promise, val);
          } else {
            fulfill(promise, val);
          }
        }, function(val) {
          if (resolved) { return true; }
          resolved = true;

          reject(promise, val);
        });

        return true;
      }
    }
  } catch (error) {
    if (resolved) { return true; }
    reject(promise, error);
    return true;
  }

  return false;
}

function resolve(promise, value) {
  if (promise === value) {
    fulfill(promise, value);
  } else if (!handleThenable(promise, value)) {
    fulfill(promise, value);
  }
}

function fulfill(promise, value) {
  if (promise._state !== PENDING) { return; }
  promise._state = SEALED;
  promise._detail = value;

  config.async(publishFulfillment, promise);
}

function reject(promise, reason) {
  if (promise._state !== PENDING) { return; }
  promise._state = SEALED;
  promise._detail = reason;

  config.async(publishRejection, promise);
}

function publishFulfillment(promise) {
  publish(promise, promise._state = FULFILLED);
}

function publishRejection(promise) {
  publish(promise, promise._state = REJECTED);
}

exports.Promise = Promise;
},{"./all":11,"./asap":12,"./config":13,"./race":16,"./reject":17,"./resolve":18,"./utils":19}],16:[function(require,module,exports){
"use strict";
/* global toString */
var isArray = require("./utils").isArray;

/**
  `RSVP.race` allows you to watch a series of promises and act as soon as the
  first promise given to the `promises` argument fulfills or rejects.

  Example:

  ```javascript
  var promise1 = new RSVP.Promise(function(resolve, reject){
    setTimeout(function(){
      resolve("promise 1");
    }, 200);
  });

  var promise2 = new RSVP.Promise(function(resolve, reject){
    setTimeout(function(){
      resolve("promise 2");
    }, 100);
  });

  RSVP.race([promise1, promise2]).then(function(result){
    // result === "promise 2" because it was resolved before promise1
    // was resolved.
  });
  ```

  `RSVP.race` is deterministic in that only the state of the first completed
  promise matters. For example, even if other promises given to the `promises`
  array argument are resolved, but the first completed promise has become
  rejected before the other promises became fulfilled, the returned promise
  will become rejected:

  ```javascript
  var promise1 = new RSVP.Promise(function(resolve, reject){
    setTimeout(function(){
      resolve("promise 1");
    }, 200);
  });

  var promise2 = new RSVP.Promise(function(resolve, reject){
    setTimeout(function(){
      reject(new Error("promise 2"));
    }, 100);
  });

  RSVP.race([promise1, promise2]).then(function(result){
    // Code here never runs because there are rejected promises!
  }, function(reason){
    // reason.message === "promise2" because promise 2 became rejected before
    // promise 1 became fulfilled
  });
  ```

  @method race
  @for RSVP
  @param {Array} promises array of promises to observe
  @param {String} label optional string for describing the promise returned.
  Useful for tooling.
  @return {Promise} a promise that becomes fulfilled with the value the first
  completed promises is resolved with if the first completed promise was
  fulfilled, or rejected with the reason that the first completed promise
  was rejected with.
*/
function race(promises) {
  /*jshint validthis:true */
  var Promise = this;

  if (!isArray(promises)) {
    throw new TypeError('You must pass an array to race.');
  }
  return new Promise(function(resolve, reject) {
    var results = [], promise;

    for (var i = 0; i < promises.length; i++) {
      promise = promises[i];

      if (promise && typeof promise.then === 'function') {
        promise.then(resolve, reject);
      } else {
        resolve(promise);
      }
    }
  });
}

exports.race = race;
},{"./utils":19}],17:[function(require,module,exports){
"use strict";
/**
  `RSVP.reject` returns a promise that will become rejected with the passed
  `reason`. `RSVP.reject` is essentially shorthand for the following:

  ```javascript
  var promise = new RSVP.Promise(function(resolve, reject){
    reject(new Error('WHOOPS'));
  });

  promise.then(function(value){
    // Code here doesn't run because the promise is rejected!
  }, function(reason){
    // reason.message === 'WHOOPS'
  });
  ```

  Instead of writing the above, your code now simply becomes the following:

  ```javascript
  var promise = RSVP.reject(new Error('WHOOPS'));

  promise.then(function(value){
    // Code here doesn't run because the promise is rejected!
  }, function(reason){
    // reason.message === 'WHOOPS'
  });
  ```

  @method reject
  @for RSVP
  @param {Any} reason value that the returned promise will be rejected with.
  @param {String} label optional string for identifying the returned promise.
  Useful for tooling.
  @return {Promise} a promise that will become rejected with the given
  `reason`.
*/
function reject(reason) {
  /*jshint validthis:true */
  var Promise = this;

  return new Promise(function (resolve, reject) {
    reject(reason);
  });
}

exports.reject = reject;
},{}],18:[function(require,module,exports){
"use strict";
function resolve(value) {
  /*jshint validthis:true */
  if (value && typeof value === 'object' && value.constructor === this) {
    return value;
  }

  var Promise = this;

  return new Promise(function(resolve) {
    resolve(value);
  });
}

exports.resolve = resolve;
},{}],19:[function(require,module,exports){
"use strict";
function objectOrFunction(x) {
  return isFunction(x) || (typeof x === "object" && x !== null);
}

function isFunction(x) {
  return typeof x === "function";
}

function isArray(x) {
  return Object.prototype.toString.call(x) === "[object Array]";
}

// Date.now is not available in browsers < IE9
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/now#Compatibility
var now = Date.now || function() { return new Date().getTime(); };


exports.objectOrFunction = objectOrFunction;
exports.isFunction = isFunction;
exports.isArray = isArray;
exports.now = now;
},{}]},{},[1,2,3,4,5,6,7,8])


//# sourceMappingURL=tw.js.map.js