const test = require('node:test');
const assert = require('node:assert/strict');
const {guide} = require('../transfer.js');
const a = {lineId:'A',line:'A선',from:'가',to:'나',stations:['가','나']};
const b = {lineId:'B',line:'B선',from:'나',to:'다',stations:['나','다']};
// Synthetic stations and source: these numbers are test fixtures, not travel advice.
const record = {station:'나',fromLine:'A',toLine:'B',arriveFrom:'가',departTo:'다',positions:[{car:3,door:2}],source:{name:'테스트 자료',url:'https://example.com/test'},checkedAt:'2026-11-09'};
test('matches both travel directions and explains car/door position',()=>{
 const g=guide(a,b,[record]);assert.equal(g.position,'3-2');assert.equal(g.direction,'다역 방면 승강장으로 이동');
});
test('opposite approach, opposite departure, duplicates and missing source never guess a position',()=>{
 for(const records of [[{...record,arriveFrom:'라'}],[{...record,departTo:'라'}],[record,record],[{...record,source:null}],[{...record,positions:[{car:0,door:2}]}],[],[null]]) assert.equal(guide(a,b,records).position,null);
});
test('no transfer and final destination have no transfer card',()=>{
 assert.equal(guide(a,null,[record]),null);
 assert.equal(guide(a,{...b,lineId:'A'},[record]),null);
 assert.equal(guide(a,{...b,from:'라'},[record]),null);
});
