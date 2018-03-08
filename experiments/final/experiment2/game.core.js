/*  Copyright (c) 2012 Sven "FuzzYspo0N" Bergström,
                  2013 Robert XD Hawkins

 written by : http://underscorediscovery.com
    written for : http://buildnewgames.com/real-time-multiplayer/

    substantially modified for collective behavior experiments on the web
    MIT Licensed.
*/

/*
  The main game class. This gets created on both server and
  client. Server creates one for each game that is hosted, and each
  client creates one for itself to play the game. When you set a
  variable, remember that it's only set in that instance.
*/

var has_require = typeof require !== 'undefined';

if( typeof _ === 'undefined' ) {
  if( has_require ) {
    _ = require('lodash');
    utils  = require(__base + 'sharedUtils/sharedUtils.js');
    assert = require('assert');
  }
  else throw 'mymodule requires underscore, see http://underscorejs.org';
}

var game_core = function(options){
  // Store a flag if we are the server instance
  this.server = options.server ;

  // Some config settings
  this.email = 'rxdh@stanford.edu';
  this.projectName = 'ToM';
  this.experimentName = 'speakerManipulation';
  this.iterationName = 'pilot0';
  this.anonymizeCSV = true;
  this.bonusAmt = 1; // in cents
  
  // save data to the following locations (allowed: 'csv', 'mongo')
  this.dataStore = ['csv', 'mongo'];

  // How many players in the game?
  this.players_threshold = 2;
  this.playerRoleNames = {
    role1 : 'speaker',
    role2 : 'listener'
  };

  //Dimensions of world in pixels and numberof cells to be divided into;
  this.numHorizontalCells = 3;
  this.numVerticalCells = 3;
  this.cellDimensions = {height : 600, width : 600}; // in pixels
  this.cellPadding = 0;
  this.world = {
    height: 600 * this.numVerticalCells,
    width: 600 * this.numHorizontalCells
  };
  
  // Which round are we on (initialize at -1 so that first round is 0-indexed)
  this.roundNum = -1;
  this.numOcclusions = 2;
  
  // How many rounds do we want people to complete?
  this.numRounds = 2;
  this.feedbackDelay = 300;

  // This will be populated with the tangram set
  this.trialInfo = {roles: _.values(this.playerRoleNames)};

  if(this.server) {
    this.id = options.id;
    this.expName = options.expName;
    this.player_count = options.player_count;
    this.objects = require('./objects.json');
    this.condition = _.sample(['within']);
    this.trialList = this.makeTrialList();
    this.data = {
      id : this.id,
      subject_information : {
	score: 0,
        gameID: this.id
      }
    };
    this.players = [{
      id: options.player_instances[0].id,
      instance: options.player_instances[0].player,
      player: new game_player(this,options.player_instances[0].player)
    }];
    this.streams = {};
    this.server_send_update();
  } else {
    // If we're initializing a player's local game copy, create the player object
    this.players = [{
      id: null,
      instance: null,
      player: new game_player(this)
    }];
  }
};

var game_player = function( game_instance, player_instance) {
  this.instance = player_instance;
  this.game = game_instance;
  this.role = '';
  this.message = '';
  this.id = '';
};

// server side we set some classes to global types, so that
// we can use them in other files (specifically, game.server.js)
if('undefined' != typeof global) {
  module.exports = {game_core, game_player};
}

// HELPER FUNCTIONS

// Method to easily look up player
game_core.prototype.get_player = function(id) {
  var result = _.find(this.players, function(e){ return e.id == id; });
  return result.player;
};

// Method to get list of players that aren't the given id
game_core.prototype.get_others = function(id) {
  var otherPlayersList = _.filter(this.players, function(e){ return e.id != id; });
  var noEmptiesList = _.map(otherPlayersList, function(p){return p.player ? p : null;});
  return _.without(noEmptiesList, null);
};

// Returns all players
game_core.prototype.get_active_players = function() {
  var noEmptiesList = _.map(this.players, function(p){return p.player ? p : null;});
  return _.without(noEmptiesList, null);
};

game_core.prototype.newRound = function(delay) {
  var players = this.get_active_players();
  var localThis = this;
  setTimeout(function() {
    // If you've reached the planned number of rounds, end the game
    if(localThis.roundNum == localThis.numRounds - 1) {
      _.forEach(players, p => p.player.instance.emit( 'finishedGame' ));
    } else {
      // Tell players
      _.forEach(players, p => p.player.instance.emit( 'newRoundUpdate'));

      // Otherwise, get the preset list of tangrams for the new round
      localThis.roundNum += 1;

      localThis.trialInfo = {
	currStim: localThis.trialList[localThis.roundNum],
	currContextType: localThis.contextTypeList[localThis.roundNum],
	roles: _.zipObject(_.map(localThis.players, p =>p.id),
			   _.values(localThis.trialInfo.roles))
      };
      localThis.server_send_update();
    }
  }, delay);
};

game_core.prototype.coordExtension = function(obj, gridCell) {
  return {
    trueX : gridCell.centerX - obj.width/2,
    trueY : gridCell.centerY - obj.height/2,
    gridPixelX: gridCell.centerX - 100,
    gridPixelY: gridCell.centerY - 100
  };
};

// Take condition as argument
// construct context list w/ statistics of condition
game_core.prototype.makeTrialList = function () {
  var that = this;
  var trialList = [];
  this.contextTypeList = [];
  var sequence = this.sampleSequence();
//  console.log(sequence);
  for (var i = 0; i < this.numRounds; i++) {
    var trialInfo = sequence[i];
    this.contextTypeList.push(trialInfo['trialType']);
    var world = this.sampleTrial(trialInfo['target'], trialInfo['trialType']);
    // supplement object with useful info
    world.objects = _.map(world.objects, function(obj) {
      var newObj = _.clone(obj);
      var speakerGridCell = that.getPixelFromCell(obj.speakerCoords);
      var listenerGridCell = that.getPixelFromCell(obj.listenerCoords);
      newObj.width = that.cellDimensions.width * 3/4;
      newObj.height = that.cellDimensions.height * 3/4;
      _.extend(newObj.speakerCoords, that.coordExtension(newObj, speakerGridCell));
      _.extend(newObj.listenerCoords, that.coordExtension(newObj, listenerGridCell));
      return newObj;
    });
    trialList.push(world);
  };
  return(trialList);
};

var designMatrix = {
  'within' : ['basic']
};

// Ensure each object appears even number of times, evenly spaced across trial types...?
game_core.prototype.sampleSequence = function() {
  var trials = designMatrix[this.condition];
  var targetRepetitions = this.numRounds / this.objects.length;
  var trialTypeSequenceLength = trials.length;
  var that = this;
  var proposal = _.flattenDeep(_.map(_.range(targetRepetitions / trialTypeSequenceLength), i => {
    return _.shuffle(_.flatten(_.map(that.objects, function(target) {
      return _.map(trials, function(trialType) {
	return {target, trialType};
      });
    })));
  }));
  if( checkSequence(proposal) ) {
    return proposal;
  } else {
    return this.sampleSequence();
  }
};

// Want to make sure there are no adjacent targets (e.g. gap is at least 1 apart?)
function mapPairwise(arr, func){
  var l = [];
  for(var i=0;i<arr.length-1;i++){
    l.push(func(arr[i], arr[i+1]));
  }
  return l;
}

var checkSequence = function(proposalList) {
  return _.every(mapPairwise(proposalList, function(curr, next) {
    return curr.target.subID !== next.target.subID;
  }));
};

// For basic/sub conditions, want to make sure there's at least one distractor at the
// same super/basic level, respectively (otherwise it's a different condition...)
var checkDistractors = function(distractors, target, contextType) {
  if(contextType === 'basic') {
    return !_.isEmpty(_.filter(distractors, ['shape', target.shape]));
  } else if(contextType === 'sub') {
    return !_.isEmpty(_.filter(distractors, ['basic', target.basic]));
  } else {
    return true;
  }
};
function containsCell(cellList, cell) {
  return _.some(cellList, function(compCell) {
    return _.isEqual(cell, [compCell.gridX, compCell.gridY]);
  });
};

game_core.prototype.sampleOcclusions = function(objects, contextType) {
  var numObjsOccluded = contextType.numObjsOccluded;
  var numEmptyOccluded = this.numOcclusions - contextType.numObjsOccluded;
  var target = _.filter(objects, v => v.targetStatus == 'target')[0];
  var distractors = _.filter(objects, v => v.targetStatus == 'distractor');
  var criticalObjs = _.map(_.filter(distractors, v => v.shape == target.shape), 'name');
  var irrelevantObjs = _.map(_.filter(distractors, v => v.shape != target.shape),'name');
  var occlusions = [];
  if(contextType.occlusions == 'critical') {
    var critical = _.sample(criticalObjs);
    var rest = _.sampleSize(irrelevantObjs, numObjsOccluded - 1);
    occlusions = occlusions.concat(critical, rest);
  } else if (contextType.occlusions == 'irrelevant') {
    occlusions = occlusions.concat(_.sampleSize(irrelevantObjs, numObjsOccluded));
  }
  function getLocationsForRole (objsToOcclude, role) {
    var targetLoc = target[role + 'Coords'];
    var distractorLocs = _.map(distractors, role + 'Coords');
    var occLocs = _.map(_.filter(distractors, v =>  _.includes(objsToOcclude, v.name)),
			role + 'Coords');
    // Select the rest with empty squares
    var otherLocs = _.map(_.filter(getAllLocs(), v => {
      var s = distractorLocs.concat(targetLoc);
      return !containsCell(s, v);
    }), v => {
      return {'gridX' : v[0], 'gridY' : v[1]};
    });
    return occLocs.concat(_.sampleSize(otherLocs, numEmptyOccluded));
  };

  return {speakerCoords : getLocationsForRole(occlusions, 'speaker'),
	  listenerCoords : getLocationsForRole(occlusions, 'listener')};
};

// Randomize number of distractors
game_core.prototype.sampleDistractors = function(target, type) {
  var fCond = (type.context === 'close' ? (v) => {return true;} :
	       type.context === 'far' ?   (v) => {return v.shape != target.shape;} :
	       console.log('ERROR: contextType ' + type.context + ' not recognized'));
  var numDistractors = _.sample([2,3,4]);
  var distractors = _.sampleSize(_.filter(this.objects, fCond), numDistractors);
  if(checkDistractors(distractors, target, type.context))
    return distractors;
  else
    return this.sampleDistractors(target, type);
};

// take context type as argument
// TODO: generate full sequence of context types
game_core.prototype.sampleTrial = function(target, garbage) {
  var contextType = {context : 'far', occlusions: 'irrelevant', numObjsOccluded:1};
  var distractors = this.sampleDistractors(target, contextType);
  var locs = this.sampleStimulusLocs(distractors.concat(target).length);
  var objects = _.map(distractors.concat(target), function(obj, i) {
    return _.extend(obj, {
      targetStatus: i == distractors.concat(target).length - 1 ? 'target' : 'distractor',
      listenerCoords: {
	gridX: locs.listener[i][0],
	gridY: locs.listener[i][1]},
      speakerCoords: {
	gridX: locs.speaker[i][0],
	gridY: locs.speaker[i][1]}
    });
  });
  var occlusions = this.sampleOcclusions(objects, contextType)
  console.log('speaker objs');
  console.log(_.map(objects, 'speakerCoords'));
  console.log('speaker occlusions are : ');
  console.log(occlusions.speakerCoords);
//  console.log('listener occlusions are : ');
  
  return {objects, occlusions};
};

// maps a grid location to the exact pixel coordinates
// for x = 1,2,3,4; y = 1,2,3,4
game_core.prototype.getPixelFromCell = function (coords) {
  var x = coords.gridX;
  var y = coords.gridY;
  return {
    centerX: (this.cellPadding/2 + this.cellDimensions.width * (x - 1)
        + this.cellDimensions.width / 2),
    centerY: (this.cellPadding/2 + this.cellDimensions.height * (y - 1)
        + this.cellDimensions.height / 2),
    upperLeftX : (this.cellDimensions.width * (x - 1) + this.cellPadding/2),
    upperLeftY : (this.cellDimensions.height * (y - 1) + this.cellPadding/2),
    width: this.cellDimensions.width,
    height: this.cellDimensions.height
  };
};

function getAllLocs() {
  return [[1,1], [2,1], [3,1],
	  [1,2], [2,2], [3,2],
	  [1,3], [2,3], [3,3]];
};

game_core.prototype.sampleStimulusLocs = function(numObjects) {
  var listenerLocs = _.sampleSize(getAllLocs(), numObjects);
  var speakerLocs = _.sampleSize(getAllLocs(), numObjects);
  return {listener : listenerLocs, speaker : speakerLocs};
};

game_core.prototype.server_send_update = function(){
  //Make a snapshot of the current state, for updating the clients
  var local_game = this;

  // Add info about all players
  var player_packet = _.map(local_game.players, function(p){
    return {id: p.id,
            player: null};
  });

  var state = {
    gs : this.game_started,   // true when game's started
    pt : this.players_threshold,
    pc : this.player_count,
    dataObj  : this.data,
    roundNum : this.roundNum,
    trialInfo: this.trialInfo,
    language: this.language,
    allObjects: this.objects
  };
  _.extend(state, {players: player_packet});
  _.extend(state, {instructions: this.instructions});

  //Send the snapshot to the players
  this.state = state;
  _.map(local_game.get_active_players(), function(p){
    p.player.instance.emit( 'onserverupdate', state);});
};