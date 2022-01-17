import {combineReducers} from "@reduxjs/toolkit";
import add from './add/add';
const reducers = combineReducers({
    add //게시물 추가
});

export default reducers;