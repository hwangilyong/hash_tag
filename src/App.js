import './assets/css/common.css';
import './container/add/AddContainer'
import {BrowserRouter, Route, Router, Routes} from "react-router-dom";
import AddContainer from "./container/add/AddContainer";

export default function App() {
  return (
      <BrowserRouter>
          <Routes>
            <Route exact={true} path='/' element={<AddContainer />}/>
          </Routes>
      </BrowserRouter>
  );
}

