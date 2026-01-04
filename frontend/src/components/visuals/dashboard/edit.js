import { useContext, useLayoutEffect, useState, useRef } from "react";
import { UserContext } from "../../../App";
import { useNavigate, useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { useMutation } from "@apollo/client";
import { profanity } from "@2toad/profanity";
import {
  MY_VISUALS,
  DELETE_VISUAL,
  NEW_VISUAL,
} from "../../../queries/visuals";

export function EditModalManager({
  visMetadata,
  setShowEdit,
  changeVisMetadata,
}) {
  const { currentUser } = useContext(UserContext);
  const navigate = useNavigate();

  const [createNewVisual, { data: copyData, error }] = useMutation(NEW_VISUAL, {
    refetchQueries: [MY_VISUALS, "VisualsQuery"],
  });

  async function createVisualCopy() {
    const response = await fetch(visMetadata?.code?.url);
    const codeBlob = await response.blob();

    // Could also copy the documentation
    // Add copy to the regular dashboard

    const newData = {
      title: visMetadata?.title + " (copy)",
      description: visMetadata?.description,
      parameters: visMetadata?.parameters,
      author: {
        connect: {
          id: currentUser?.id,
        },
      },
      editable: true,
      code: {
        upload: codeBlob,
      },
      // docs: visMetadata?.docs,
      extensions: visMetadata?.extensions,
    };

    if (visMetadata?.docsVisible && visMetadata?.privacy === "pulic") {
      newData[docs] === visMetadata?.docs;
    }

    await createNewVisual({
      variables: { data: newData },
    });
  }

  if (copyData) {
    setTimeout(() => {
      navigate(`/visuals/${copyData?.createVisual?.id}`);
    }, 500);
    return <p>Redirecting you to the copy...</p>;
  }

  if (!currentUser?.id) {
    return <SignInEditPopup />;
  }

  if (currentUser.id !== visMetadata?.author?.id) {
    return <CopyEditPopup createVisualCopy={createVisualCopy} />;
  }

  return (
    <EditScreen
      visMetadata={visMetadata}
      setShowEdit={setShowEdit}
      changeVisMetadata={changeVisMetadata}
      createVisualCopy={createVisualCopy}
    />
  );
}

function SignInEditPopup() {
  const { visID } = useParams();

  return (
    <div>
      <p>To modify the visuals, you need an account.</p>
      <Link
        to={`/login?visual=${visID}`}
        className="btn btn-secondary btn-outline-dark me-2"
      >
        Log In
      </Link>
      <Link to={`/signup?visual=${visID}`} className="btn btn-outline-dark">
        Sign Up
      </Link>
    </div>
  );
}

function CopyEditPopup({ createVisualCopy }) {
  return (
    <div>
      <p> You do not own this visualization.</p>
      <button
        className="btn btn-secondary btn-outline-dark"
        onClick={createVisualCopy}
      >
        Create a copy?
      </button>
      <button className="btn btn-outline-dark ms-2">Sign Out</button>
    </div>
  );
}

function EditScreen({
  visMetadata,
  setShowEdit,
  changeVisMetadata,
  createVisualCopy,
}) {
  const textbox = useRef(null);
  const navigate = useNavigate();
  const [visName, setVisName] = useState(visMetadata?.title);
  const [visCover, setVisCover] = useState();
  const [errorMessage, setErrorMessage] = useState();
  const [visDescription, setVisDescription] = useState(
    visMetadata?.description
  );
  const [extensions, setExtensions] = useState(visMetadata?.extensions || []);
  const [parameters, setParameters] = useState(visMetadata?.parameters || []);

  let isFormValid = visName && visDescription && !errorMessage;

  const [deleteVisual, { data: visualDeleted, loading, error }] = useMutation(
    DELETE_VISUAL,
    { variables: { id: visMetadata?.id } }
  );

  function deleteButtonCallback() {
    const checkConfirmation = confirm(
      "Are you sure you want to delete the current visual?"
    );
    if (checkConfirmation) {
      deleteVisual();
      navigate("/visuals");
    }
  }

  function validateName(input) {
    const regex = /^(?!.*[%$\-\/])[^\n\r]{1,50}$/;
    if (!regex.test(input) || profanity.exists(input)) {
      setVisName("");
      setErrorMessage("Invalid name");
      return;
    }
    setVisName(input);
    setErrorMessage();
  }

  function validateDescription(input) {
    const regex = /^(?!.*[%$\-\/])[^\n\r]{1,1000}$/;
    if (!regex.test(input) || profanity.exists(input)) {
      setVisDescription("");
      setErrorMessage("Invalid description");
      return;
    }
    setVisDescription(input);
    setErrorMessage();
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    if (!isFormValid) {
      return;
    }
    const data = {
      title: visName,
      description: visDescription,
      extensions: extensions,
      parameters: parameters,
    };

    if (visCover) {
      data["cover"] = {
        upload: visCover,
      };
    }

    changeVisMetadata({
      variables: {
        data,
      },
    });
    setShowEdit(false);
  }

  function handleEditClick(e) {
    e.preventDefault();
    createVisualCopy();
  }

  useLayoutEffect(() => {
    textbox.current.style.height = "inherit";
    textbox.current.style.resize = "none";
    textbox.current.style.height = `${textbox.current.scrollHeight}px`;
  });

  if (visualDeleted) {
    navigate("/visuals");
  }

  return (
    <div>
      <div className="d-flex justify-content-between">
        <button
          className="devices-close-btn h4 text-end"
          onClick={() => setShowEdit(false)}
        >
          <i className="bi bi-x"></i>
        </button>
        <h3 className="mb-3">Edit</h3>
      </div>
      <form onSubmit={handleFormSubmit}>
        <div className="mb-3">
          <label htmlFor="visualName" id="basic-addon2">
            Name
          </label>
          <input
            type="text"
            className="form-control"
            placeholder="Visual name"
            aria-label="Visual name"
            id="visualName"
            autoComplete="off"
            onChange={(e) => validateName(e.target.value)}
            value={visName}
          />
        </div>
        <div className="mb-3">
          <label htmlFor="description">Description</label>
          <textarea
            type="text"
            className="form-control"
            id="description"
            placeholder="Description"
            onChange={(e) => validateDescription(e.target.value)}
            value={visDescription}
            ref={textbox}
          />
        </div>
        <div className="mb-4">
          <label htmlFor="inputUpload">Cover</label>
          <input
            type="file"
            className="form-control"
            id="inputUpload"
            accept=".png,.jpg"
            onChange={(e) => handleCoverUpload(e, setVisCover)}
          />
        </div>
        <div className="mb-4">
          <label>External Libraries</label>
          <div className="mb-2">
            <small className="text-muted">
              Add CDN links to external JavaScript libraries (e.g., Tone.js, Three.js)
            </small>
          </div>
          {extensions.map((ext, idx) => (
            <div key={idx} className="input-group mb-2">
              <input
                type="text"
                className="form-control"
                placeholder="https://cdn.example.com/library.js"
                value={ext.url || ''}
                onChange={(e) => {
                  const newExts = [...extensions];
                  newExts[idx] = { url: e.target.value };
                  setExtensions(newExts);
                }}
              />
              <button
                className="btn btn-outline-danger"
                type="button"
                onClick={() => {
                  setExtensions(extensions.filter((_, i) => i !== idx));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setExtensions([...extensions, { url: '' }])}
          >
            + Add Library
          </button>
        </div>
        <div className="mb-4">
          <label>Parameters</label>
          <div className="mb-2">
            <small className="text-muted">
              Parameters that your visual will receive data for
            </small>
          </div>
          {parameters.map((param, idx) => (
            <div key={idx} className="mb-2">
              <div className="input-group mb-1">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Parameter name (e.g., Chorus)"
                  value={param.name || ''}
                  onChange={(e) => {
                    const newParams = [...parameters];
                    newParams[idx] = { ...param, name: e.target.value };
                    setParameters(newParams);
                  }}
                />
                <button
                  className="btn btn-outline-danger"
                  type="button"
                  onClick={() => {
                    setParameters(parameters.filter((_, i) => i !== idx));
                  }}
                >
                  Remove
                </button>
              </div>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Suggested data streams (comma separated, optional)"
                value={param.suggested?.join(', ') || ''}
                onChange={(e) => {
                  const newParams = [...parameters];
                  newParams[idx] = {
                    ...param,
                    suggested: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                  };
                  setParameters(newParams);
                }}
              />
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setParameters([...parameters, { name: '', suggested: [] }])}
          >
            + Add Parameter
          </button>
        </div>
        {errorMessage && <p className="text-warning">{errorMessage}</p>}
        <div className="d-flex justify-content-between">
          <button
            className="btn btn-outline-danger"
            onClick={deleteButtonCallback}
            type="button"
          >
            Delete visual
          </button>
          <div className="d-flex">
            <button
              className="btn btn-outline-dark me-2"
              onClick={handleEditClick}
              type="button"
            >
              Copy visual
            </button>
            <button
              type="submit"
              className={`btn btn-secondary btn-outline-dark ${
                !isFormValid && "disabled"
              }`}
            >
              <span className="material-symbols-outlined inline-icon">
                save
              </span>
              Save changes
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

async function handleCoverUpload(e, setVisCover) {
  const form = e.currentTarget;
  const [file] = await form.files;

  if (!file) {
    setVisCover();
    console.log("No cover");
    return;
  }

  setVisCover(file);
}
